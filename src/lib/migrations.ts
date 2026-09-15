/**
 * Pure migration helpers — extracted from main.ts so they can be tested
 * without standing up the full adapter Lifecycle.
 *
 * Each helper takes the minimum adapter surface it needs as a typed
 * dependency interface. Implementations stay in main.ts behind thin
 * wrappers that pass `this`.
 */

import { errText } from "../types/utils";
import type { DeviceConfig } from "../hue-api";
import { assignDeviceIds } from "./device-ids";

/**
 * Upper bound for `getObjectList`/`getObjectView` range queries over an id
 * prefix — the highest BMP code unit, so the range covers every sanitized id.
 */
export const ID_RANGE_END = "￿";

/** Light type keys understood by the legacy-device migration. */
export type LegacyLightType = "onoff" | "dimmable" | "ct" | "color";

/**
 * Determine the Hue light type from the set of available legacy state keys.
 * Priority: any colour state (hue/sat/xy) → `color`; else `ct` → `ct`; else
 * `bri` → `dimmable`; otherwise `onoff`. Pure decision helper extracted from
 * main.ts's legacy-device migration so it can be unit-tested directly.
 *
 * @param stateKeys - Set of state leaf names found under the legacy device
 */
export function detectLegacyLightType(stateKeys: Set<string>): LegacyLightType {
  if (stateKeys.has("hue") || stateKeys.has("sat") || stateKeys.has("xy")) {
    return "color";
  }
  if (stateKeys.has("ct")) {
    return "ct";
  }
  if (stateKeys.has("bri")) {
    return "dimmable";
  }
  return "onoff";
}

/**
 * Obsolete state IDs from earlier hueemu versions, kept centralized so the
 * cleanup is testable and grep-findable. Each row carries the version that
 * removed the state for documentation.
 */
export const OBSOLETE_STATE_IDS: ReadonlyArray<{ id: string; removedIn: string }> = [
  { id: "info.configuredDevices", removedIn: "1.0.15" },
  { id: "createLight", removedIn: "1.1.0" },
];

/*
 * `info.connection` and `info` were on this list from 1.1.3 until v1.17.0, which
 * brought them back as the adapter's serving indicator. They HAD to come off:
 * this cleanup runs late in onReady, after the objects are created, so an id
 * that is both created and listed here would be created and deleted on every
 * single start.
 */

/** Adapter surface required by `runObsoleteStateCleanup`. */
export interface ObsoleteStateCleanupAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** Read an object by ID */
  getObjectAsync(id: string): Promise<unknown>;
  /** Delete an object by ID */
  delObjectAsync(id: string): Promise<unknown>;
  /** List objects within a key range */
  getObjectListAsync(query: {
    startkey: string;
    endkey: string;
  }): Promise<{ rows: Array<{ id: string }> } | null | undefined>;
  /** Logger with debug method */
  log: { debug(message: string): void };
}

/**
 * Delete obsolete state IDs and clean up empty parent channels/folders.
 *
 * @param adapter Minimum adapter surface.
 */
export async function runObsoleteStateCleanup(adapter: ObsoleteStateCleanupAdapter): Promise<void> {
  for (const { id } of OBSOLETE_STATE_IDS) {
    const obj = await adapter.getObjectAsync(id);
    if (!obj) {
      continue;
    }
    await adapter.delObjectAsync(id);
    adapter.log.debug(`Removed obsolete state: ${id}`);

    const dot = id.lastIndexOf(".");
    if (dot < 0) {
      continue;
    }
    const parentId = id.substring(0, dot);
    const children = await adapter.getObjectListAsync({
      startkey: `${adapter.namespace}.${parentId}.`,
      endkey: `${adapter.namespace}.${parentId}.${ID_RANGE_END}`,
    });
    if (children?.rows.length === 0) {
      await adapter.delObjectAsync(parentId);
      adapter.log.debug(`Removed empty parent: ${parentId}`);
    }
  }
}

/** Adapter surface required by {@link runLegacyDeviceMigration}. */
export interface LegacyDeviceMigrationAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** Already-configured devices (this.config.devices) — migration is skipped if non-empty. */
  configuredDevices: DeviceConfig[] | undefined;
  /** List legacy device objects in the adapter namespace */
  getDevicesAsync(): Promise<ioBroker.DeviceObject[]>;
  /** Read a state by (namespace-relative) id */
  getStateAsync(id: string): Promise<ioBroker.State | null | undefined>;
  /** List the state objects of a device's channel */
  getStatesOfAsync(parentDevice: string, parentChannel: string): Promise<ioBroker.StateObject[]>;
  /** Persist the migrated device list into native (triggers a restart) */
  extendForeignObjectAsync(id: string, obj: { native: { devices: DeviceConfig[] } }): Promise<unknown>;
  /** Delete an object by (namespace-relative) id */
  delObjectAsync(id: string): Promise<unknown>;
  /** Logger with info + warn */
  log: { info(message: string): void; warn(message: string): void };
}

/**
 * Migrate legacy devices (created via the old `createLight` JSON) into the admin
 * DeviceConfig format. Pure helper — like {@link runInstanceObjectMigration} and
 * {@link runObsoleteStateCleanup} — so it is unit-testable without standing up the
 * full adapter lifecycle. Returns `true` when a migration was written; the caller
 * then lets the resulting native write restart the instance.
 *
 * @param adapter Minimal adapter surface (see {@link LegacyDeviceMigrationAdapter}).
 * @returns true if a migration was performed (adapter will restart with the new config)
 */
export async function runLegacyDeviceMigration(adapter: LegacyDeviceMigrationAdapter): Promise<boolean> {
  // Skip if devices are already configured in admin.
  if (adapter.configuredDevices && adapter.configuredDevices.length > 0) {
    return false;
  }

  const devices = await adapter.getDevicesAsync();
  if (devices.length === 0) {
    return false;
  }

  adapter.log.info(`Found ${devices.length} legacy device(s) — migrating to new configuration`);

  const migratedDevices: DeviceConfig[] = [];
  for (const device of devices) {
    const deviceId = device._id.substring(adapter.namespace.length + 1);
    try {
      // Read the display name from the name state or the device common.name
      // (type-guarded: state.val may be number/bool, common.name a translation object).
      const nameState = await adapter.getStateAsync(`${deviceId}.name`);
      const nameVal = typeof nameState?.val === "string" ? nameState.val : undefined;
      const commonName = typeof device.common?.name === "string" ? device.common.name : undefined;
      const name = nameVal || commonName || deviceId;

      const stateObjects = await adapter.getStatesOfAsync(deviceId, "state");
      const stateKeys = new Set((stateObjects || []).map(s => s._id.substring(s._id.lastIndexOf(".") + 1)));
      const lightType = detectLegacyLightType(stateKeys);

      const config: DeviceConfig = { name, lightType };
      if (stateKeys.has("on")) {
        config.onState = `${adapter.namespace}.${deviceId}.state.on`;
      }
      if (stateKeys.has("bri")) {
        config.briState = `${adapter.namespace}.${deviceId}.state.bri`;
      }
      if (stateKeys.has("ct")) {
        config.ctState = `${adapter.namespace}.${deviceId}.state.ct`;
      }
      if (stateKeys.has("hue")) {
        config.hueState = `${adapter.namespace}.${deviceId}.state.hue`;
      }
      if (stateKeys.has("sat")) {
        config.satState = `${adapter.namespace}.${deviceId}.state.sat`;
      }
      if (stateKeys.has("xy")) {
        config.xyState = `${adapter.namespace}.${deviceId}.state.xy`;
      }

      migratedDevices.push(config);
      adapter.log.info(`Migrated legacy device "${name}" as ${lightType}`);

      // v1.4.3 (M6) / v1.10.0 (L2): remove only the obsolete metadata wrappers.
      // The device (`${deviceId}`) + channel (`${deviceId}.state`) containers and
      // their state.* leaves are kept — DeviceBindingService binds to the leaves
      // and delObject is non-recursive, so deleting the parents would orphan them.
      await Promise.all([
        adapter.delObjectAsync(`${deviceId}.name`).catch(() => {}),
        adapter.delObjectAsync(`${deviceId}.data`).catch(() => {}),
      ]);
    } catch (error) {
      adapter.log.warn(`Could not migrate legacy device ${deviceId}: ${errText(error)}`);
    }
  }

  if (migratedDevices.length === 0) {
    return false;
  }

  await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
    // Number the converted lights right away — one restart instead of two.
    native: { devices: assignDeviceIds(migratedDevices).devices },
  });
  adapter.log.info(`Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`);
  return true;
}

/** Adapter surface required by {@link runDeviceIdMigration}. */
export interface DeviceIdMigrationAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** Persist the numbered device list into the instance's native config */
  extendForeignObjectAsync(id: string, obj: { native: { devices: DeviceConfig[] } }): Promise<unknown>;
  /** Logger */
  log: { info(message: string): void; warn(message: string): void };
}

/**
 * Number the stored lights once and persist the result.
 *
 * Same contract as the settings-key migration: `true` means the instance object
 * was written and the caller must stop — the host restarts the instance with
 * the numbered configuration. `false` means nothing had to change, or the write
 * failed: then `devices` was numbered in memory and the start continues with
 * these numbers (the write is retried on the next start).
 *
 * @param adapter Minimum adapter surface (object extend + log).
 * @param devices The stored device configurations — numbered IN PLACE on a
 *   failed write, so the running adapter and a later successful write agree.
 */
export async function runDeviceIdMigration(
  adapter: DeviceIdMigrationAdapter,
  devices: DeviceConfig[],
): Promise<boolean> {
  const numbered = assignDeviceIds(devices);
  if (!numbered.changed) {
    return false;
  }
  try {
    await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
      native: { devices: numbered.devices },
    });
    adapter.log.info(
      `Assigned permanent light numbers to ${devices.length} configured light(s) — this instance restarts once`,
    );
    return true;
  } catch (error) {
    adapter.log.warn(`Light numbers could not be stored (${errText(error)}) — using them for this run only`);
    numbered.devices.forEach((device, index) => {
      devices[index] = device;
    });
    return false;
  }
}
