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
import { deriveCtScale, deriveHueScale, deriveLevelScale, stateFactsOf, type StateFacts } from "./device-scan";

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
  { id: "info.connection", removedIn: "1.1.3" },
  { id: "info", removedIn: "1.1.3" },
  { id: "createLight", removedIn: "1.1.0" },
];

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
    native: { devices: migratedDevices },
  });
  adapter.log.info(`Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`);
  return true;
}

/**
 * v1.15.0 — backfill the per-device value scales on EXISTING configurations.
 *
 * The 2026-09-03 audit found that the v1.11.0 "Search lights" assistant never
 * wrote a scale, so a hue source in degrees was read and written as if it were
 * Hue-native. Fixing the assistant only helps new entries: `searchDevices`
 * skips every light whose on/off state is already mapped, so a re-scan would
 * never touch the broken ones. This runs once at start and fills what it can
 * prove.
 *
 * Guard rails, deliberately narrow:
 *  - only ABSENT scale fields are filled — a value the user picked by hand, or
 *    one a previous run derived, is never overwritten,
 *  - evidence is `common.min`/`common.max` and `common.unit` only, never the
 *    role (see `deriveCtScale`),
 *  - no evidence → the field stays empty, which is exactly today's behaviour.
 */

/** Facts of the source states a device binds, keyed by Hue attribute. */
export interface DeviceScaleFacts {
  /** Facts of the brightness source. */
  bri?: StateFacts;
  /** Facts of the saturation source. */
  sat?: StateFacts;
  /** Facts of the hue source. */
  hue?: StateFacts;
  /** Facts of the colour-temperature source. */
  ct?: StateFacts;
}

/**
 * Build the scale patch for one device, or `null` when nothing can be proven.
 * Pure — the caller supplies the facts it read from the object database.
 *
 * @param device The stored device configuration.
 * @param facts Facts of the states this device binds.
 */
export function buildDeviceScalePatch(device: DeviceConfig, facts: DeviceScaleFacts): Partial<DeviceConfig> | null {
  const patch: Partial<DeviceConfig> = {};
  if (device.briState && !device.briScale) {
    const scale = deriveLevelScale(facts.bri);
    if (scale) {
      patch.briScale = scale;
    }
  }
  if (device.satState && !device.satScale) {
    const scale = deriveLevelScale(facts.sat);
    if (scale) {
      patch.satScale = scale;
    }
  }
  if (device.hueState && !device.hueScale) {
    const scale = deriveHueScale(facts.hue);
    if (scale) {
      patch.hueScale = scale;
    }
  }
  if (device.ctState && !device.ctScale) {
    const scale = deriveCtScale(facts.ct);
    if (scale) {
      patch.ctScale = scale;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Adapter surface required by {@link runDeviceScaleBackfill}. */
export interface DeviceScaleBackfillAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** Read a foreign object by ID */
  getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
  /** Persist the patched device list into the instance's native config */
  extendForeignObjectAsync(id: string, obj: { native: { devices: DeviceConfig[] } }): Promise<unknown>;
  /** Logger */
  log: { info(message: string): void; debug(message: string): void };
}

/**
 * Apply {@link buildDeviceScalePatch} to every stored device and persist the
 * result when anything changed.
 *
 * @param adapter Minimum adapter surface (object read/extend + log).
 * @param devices The stored device configurations.
 * @returns `true` when the config was rewritten — the instance restarts, so the
 *   caller must stop instead of binding servers that are about to go down.
 */
export async function runDeviceScaleBackfill(
  adapter: DeviceScaleBackfillAdapter,
  devices: DeviceConfig[],
): Promise<boolean> {
  if (!devices.length) {
    return false;
  }

  /**
   * Read the facts of one bound state, tolerating a missing object.
   *
   * @param id The state id, when the device binds one.
   */
  const factsFor = async (id: string | undefined): Promise<StateFacts | undefined> => {
    if (!id) {
      return undefined;
    }
    try {
      return stateFactsOf(await adapter.getForeignObjectAsync(id));
    } catch (error) {
      adapter.log.debug(`Scale backfill: could not read ${id}: ${errText(error)}`);
      return undefined;
    }
  };

  const patched: DeviceConfig[] = [];
  let changed = 0;
  for (const device of devices) {
    const patch = buildDeviceScalePatch(device, {
      bri: await factsFor(device.briState),
      sat: await factsFor(device.satState),
      hue: await factsFor(device.hueState),
      ct: await factsFor(device.ctState),
    });
    if (patch) {
      changed++;
      adapter.log.debug(`Scale backfill for "${device.name}": ${JSON.stringify(patch)}`);
      patched.push({ ...device, ...patch });
    } else {
      patched.push(device);
    }
  }

  if (changed === 0) {
    return false;
  }

  await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, { native: { devices: patched } });
  adapter.log.info(
    `Determined the value scale for ${changed} configured light(s) from their source states. Adapter will restart.`,
  );
  return true;
}
