/**
 * Pure migration helpers — extracted from main.ts so they can be tested
 * without standing up the full adapter Lifecycle.
 *
 * Each helper takes the minimum adapter surface it needs as a typed
 * dependency interface. Implementations stay in main.ts behind thin
 * wrappers that pass `this`.
 */

import { errText } from "./err-text";
import type { DeviceConfig } from "../hue-api";
import { assignDeviceIds, isDeviceId, normalizeDevices } from "./device-ids";
import type { MarkRead, StoredLights } from "./light-store";

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
  /** Whether lights are stored already — the migration is skipped then. */
  lightsStored: boolean;
  /** List legacy device objects in the adapter namespace */
  getDevicesAsync(): Promise<ioBroker.DeviceObject[]>;
  /** Read a state by (namespace-relative) id */
  getStateAsync(id: string): Promise<ioBroker.State | null | undefined>;
  /** Read an object by (namespace-relative) id — tells a pending legacy device from a migrated one */
  getObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
  /** List the state objects of a device's channel */
  getStatesOfAsync(parentDevice: string, parentChannel: string): Promise<ioBroker.StateObject[]>;
  /** Store the converted lights as light objects (light-store.ts `add`) */
  addLights(configs: DeviceConfig[]): Promise<unknown>;
  /** Delete an object by (namespace-relative) id */
  delObjectAsync(id: string): Promise<unknown>;
  /** Logger with info + warn */
  log: { info(message: string): void; warn(message: string): void };
}

/**
 * Migrate legacy devices (created via the old `createLight` JSON) into light objects. Pure helper — like
 * {@link runObsoleteStateCleanup} — so it is unit-testable without standing up the full adapter lifecycle.
 *
 * Audit R-24: the converted lights become light objects (`lights.<n>`) like every other light; up to v1.19.0 they
 * went into `native.devices` and the instance restarted.
 *
 * @param adapter Minimal adapter surface (see {@link LegacyDeviceMigrationAdapter}).
 * @returns true if lights were converted
 */
export async function runLegacyDeviceMigration(adapter: LegacyDeviceMigrationAdapter): Promise<boolean> {
  // Skip once any light is stored — no reads of every device object on every start.
  if (adapter.lightsStored) {
    return false;
  }

  // v1.19.0 (audit 2026-09-25 Q17): only a device that still carries its legacy
  // wrappers (`.name` / `.data`) is pending. The migration deletes those and keeps
  // the device, channel and leaves (the bindings point at the leaves) — so after a
  // user deleted every light, the kept containers were migrated AGAIN on the next
  // start and the deleted lights came back.
  const devices: ioBroker.DeviceObject[] = [];
  for (const device of await adapter.getDevicesAsync()) {
    const deviceId = device._id.substring(adapter.namespace.length + 1);
    const [name, data] = await Promise.all([
      adapter.getObjectAsync(`${deviceId}.name`).catch(() => null),
      adapter.getObjectAsync(`${deviceId}.data`).catch(() => null),
    ]);
    if (name || data) {
      devices.push(device);
    }
  }
  if (devices.length === 0) {
    return false;
  }

  adapter.log.info(`Found ${devices.length} legacy device(s) — migrating to new configuration`);

  const migratedDevices: DeviceConfig[] = [];
  const converted: string[] = [];
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
      converted.push(deviceId);
      adapter.log.info(`Migrated legacy device "${name}" as ${lightType}`);
    } catch (error) {
      adapter.log.warn(`Could not migrate legacy device ${deviceId}: ${errText(error)}`);
    }
  }

  if (migratedDevices.length === 0) {
    return false;
  }

  // The lights first: a failed store leaves the legacy wrappers, and the next start tries again.
  await adapter.addLights(migratedDevices);
  for (const deviceId of converted) {
    // v1.4.3 (M6) / v1.10.0 (L2): remove only the obsolete metadata wrappers.
    // The device (`${deviceId}`) + channel (`${deviceId}.state`) containers and
    // their state.* leaves are kept — DeviceBindingService binds to the leaves
    // and delObject is non-recursive, so deleting the parents would orphan them.
    await Promise.all([
      adapter.delObjectAsync(`${deviceId}.name`).catch(() => {}),
      adapter.delObjectAsync(`${deviceId}.data`).catch(() => {}),
    ]);
  }
  adapter.log.info(`Migration complete: ${migratedDevices.length} device(s) converted`);
  return true;
}

/** What {@link runLightObjectMigration} needs of the light store. */
export interface LightMigrationStore {
  /** Every light and every object below the folder. */
  list(): Promise<StoredLights>;
  /** The highest light number ever handed out. */
  readMark(): MarkRead;
  /** Store the mark (throws when it cannot). */
  writeMark(mark: number): void;
  /** Create a numbered light's objects. */
  create(light: DeviceConfig & { id: number }): Promise<void>;
}

/** The result of {@link runLightObjectMigration}. */
export interface LightMigrationResult {
  /**
   * Whether every light the settings held is a light object now, and the mark covers them — only then are the
   * settings keys dropped.
   */
  stored: boolean;
  /** When not stored: the lights to serve this run, numbered, from the settings. */
  devices?: DeviceConfig[];
}

/**
 * Audit R-24: move the lights an earlier version kept in the instance settings (`native.devices`, with the mark
 * `native.lastLightId`) into light objects, once.
 *
 * Every light keeps its number — an entry without one gets the next number above every number in use and ever handed
 * out (assignDeviceIds, audit R-02) — and a number that already has an object (a move cut off before) keeps that
 * object. The mark covers the settings' mark and every number. Only when all of it is stored does the caller drop
 * the two keys; when anything fails, this run serves the lights from the settings and the next start tries again.
 *
 * @param store The light store.
 * @param legacy What the settings hold.
 * @param legacy.devices `native.devices`
 * @param legacy.lastLightId `native.lastLightId`
 * @param log Logger with info + warn.
 * @param log.info info line
 * @param log.warn warning line
 * @returns whether the lights are stored, and the lights to serve when not
 */
export async function runLightObjectMigration(
  store: LightMigrationStore,
  legacy: { devices: unknown; lastLightId: unknown },
  log: { info(message: string): void; warn(message: string): void },
): Promise<LightMigrationResult> {
  const floor = isDeviceId(legacy.lastLightId) ? legacy.lastLightId : 0;
  const numbered = assignDeviceIds(normalizeDevices(legacy.devices), floor).devices as Array<
    DeviceConfig & { id: number }
  >;
  if (numbered.length === 0 && floor === 0) {
    return { stored: true };
  }
  try {
    const { lights } = await store.list();
    const have = new Set(lights.map(light => light.id));
    const mark = Math.max(store.readMark().mark, floor, ...numbered.map(d => d.id), ...lights.map(l => l.id ?? 0));
    store.writeMark(mark);
    const missing = numbered.filter(d => !have.has(d.id));
    for (const light of missing) {
      await store.create(light);
    }
    if (missing.length > 0) {
      log.info(`Moved ${missing.length} light(s) from the instance settings into the object tree (lights)`);
    }
    return { stored: true };
  } catch (error) {
    log.warn(
      `The lights could not be moved out of the instance settings (${errText(error)}) — serving them from there for this run`,
    );
    return { stored: false, devices: numbered };
  }
}
