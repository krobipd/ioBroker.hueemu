/**
 * Pure migration helpers — extracted from main.ts so they can be tested
 * without standing up the full adapter Lifecycle.
 *
 * Each helper takes the minimum adapter surface it needs as a typed
 * dependency interface. Implementations stay in main.ts behind thin
 * wrappers that pass `this`.
 */

import { tName } from "./i18n-states";

/** Pairs `(instanceObject id, i18n keys)` that v1.4.0 backfills. */
export const INSTANCE_OBJECT_MIGRATION_PAIRS: ReadonlyArray<{
  id: string;
  nameKey: "startPairingName" | "disableAuthName" | "clientsFolder";
  descKey?: "startPairingDesc" | "disableAuthDesc";
}> = [
  { id: "startPairing", nameKey: "startPairingName", descKey: "startPairingDesc" },
  { id: "disableAuth", nameKey: "disableAuthName", descKey: "disableAuthDesc" },
  { id: "clients", nameKey: "clientsFolder" },
];

/**
 * Object common shape we look at — narrow on purpose so the helper can
 * accept anything ioBroker hands back without typing the whole world.
 */
export interface MigratableCommon {
  name?: unknown;
  desc?: unknown;
}

/**
 * Build the partial `common` patch that should be applied via `extendObject`
 * to make `common.name`/`common.desc` translation objects. Returns `null`
 * when nothing needs to change (idempotent — caller skips the call).
 *
 * @param common Current `common` block from the object (may be undefined).
 * @param pair Migration pair specifying source ids → i18n keys.
 */
export function buildInstanceObjectMigrationPatch(
  common: MigratableCommon | undefined,
  pair: (typeof INSTANCE_OBJECT_MIGRATION_PAIRS)[number],
): { name?: unknown; desc?: unknown } | null {
  const nameIsString = typeof common?.name === "string";
  const descIsString = pair.descKey !== undefined && typeof common?.desc === "string";
  if (!nameIsString && !descIsString) {
    return null;
  }
  const patch: { name?: unknown; desc?: unknown } = {};
  if (nameIsString) {
    patch.name = tName(pair.nameKey);
  }
  if (descIsString && pair.descKey) {
    patch.desc = tName(pair.descKey);
  }
  return patch;
}

/** Adapter surface required by `runInstanceObjectMigration`. */
export interface InstanceObjectMigrationAdapter {
  getObjectAsync(id: string): Promise<{ common?: MigratableCommon } | null | undefined>;
  extendObjectAsync(id: string, obj: { common: { name?: unknown; desc?: unknown } }): Promise<unknown>;
  log: { debug(message: string): void };
}

/**
 * Iterate the migration pairs, fetch each object, compute the patch, and
 * apply it via `extendObject`. Idempotent — re-running on already-migrated
 * objects is a no-op (no extendObject call).
 *
 * @param adapter Minimum adapter surface (getObjectAsync, extendObjectAsync, log).
 */
export async function runInstanceObjectMigration(adapter: InstanceObjectMigrationAdapter): Promise<void> {
  for (const pair of INSTANCE_OBJECT_MIGRATION_PAIRS) {
    const obj = await adapter.getObjectAsync(pair.id);
    if (!obj) {
      continue;
    }
    const patch = buildInstanceObjectMigrationPatch(obj.common, pair);
    if (!patch) {
      continue;
    }
    await adapter.extendObjectAsync(pair.id, { common: patch });
    adapter.log.debug(`Translated instanceObject names: ${pair.id}`);
  }
}

/**
 * Obsolete state IDs from earlier hueemu versions, kept centralized so the
 * cleanup is testable and grep-findable. Each row carries the version that
 * removed the state for documentation.
 */
export const OBSOLETE_STATE_IDS: ReadonlyArray<{ id: string; removedIn: string }> = [
  { id: "info.configuredDevices", removedIn: "1.0.15" },
  { id: "info.connection", removedIn: "1.1.3" },
  { id: "info", removedIn: "after info.* removed" },
  { id: "createLight", removedIn: "1.1.0" },
];

/** Adapter surface required by `runObsoleteStateCleanup`. */
export interface ObsoleteStateCleanupAdapter {
  namespace: string;
  getObjectAsync(id: string): Promise<unknown>;
  delObjectAsync(id: string): Promise<unknown>;
  getObjectListAsync(query: {
    startkey: string;
    endkey: string;
  }): Promise<{ rows: Array<{ id: string }> } | null | undefined>;
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
      endkey: `${adapter.namespace}.${parentId}.香`,
    });
    if (children?.rows.length === 0) {
      await adapter.delObjectAsync(parentId);
      adapter.log.debug(`Removed empty parent: ${parentId}`);
    }
  }
}
