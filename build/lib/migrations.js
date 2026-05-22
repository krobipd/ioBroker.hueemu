"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if ((from && typeof from === "object") || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, {
          get: () => from[key],
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
        });
  }
  return to;
};
var __toCommonJS = mod => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var migrations_exports = {};
__export(migrations_exports, {
  INSTANCE_OBJECT_MIGRATION_PAIRS: () => INSTANCE_OBJECT_MIGRATION_PAIRS,
  OBSOLETE_STATE_IDS: () => OBSOLETE_STATE_IDS,
  buildInstanceObjectMigrationPatch: () => buildInstanceObjectMigrationPatch,
  runInstanceObjectMigration: () => runInstanceObjectMigration,
  runObsoleteStateCleanup: () => runObsoleteStateCleanup,
});
module.exports = __toCommonJS(migrations_exports);
var import_i18n = require("./i18n");
const INSTANCE_OBJECT_MIGRATION_PAIRS = [
  { id: "startPairing", nameKey: "startPairingName", descKey: "startPairingDesc" },
  { id: "disableAuth", nameKey: "disableAuthName", descKey: "disableAuthDesc" },
  { id: "clients", nameKey: "clientsFolder" },
];
function buildInstanceObjectMigrationPatch(common, pair) {
  const nameIsString = typeof (common == null ? void 0 : common.name) === "string";
  const descIsString = pair.descKey !== void 0 && typeof (common == null ? void 0 : common.desc) === "string";
  if (!nameIsString && !descIsString) {
    return null;
  }
  const patch = {};
  if (nameIsString) {
    patch.name = (0, import_i18n.tName)(pair.nameKey);
  }
  if (descIsString && pair.descKey) {
    patch.desc = (0, import_i18n.tName)(pair.descKey);
  }
  return patch;
}
async function runInstanceObjectMigration(adapter) {
  for (const pair of INSTANCE_OBJECT_MIGRATION_PAIRS) {
    const obj = await adapter.getObjectAsync(pair.id);
    if (!obj) {
      continue;
    }
    const patch = buildInstanceObjectMigrationPatch(obj.common, pair);
    if (!patch) {
      continue;
    }
    await adapter.extendObjectAsync(pair.id, { common: patch }, { preserve: { common: ["name"] } });
    adapter.log.debug(`Translated instanceObject names: ${pair.id}`);
  }
}
const OBSOLETE_STATE_IDS = [
  { id: "info.configuredDevices", removedIn: "1.0.15" },
  { id: "info.connection", removedIn: "1.1.3" },
  { id: "info", removedIn: "after info.* removed" },
  { id: "createLight", removedIn: "1.1.0" },
];
async function runObsoleteStateCleanup(adapter) {
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
      endkey: `${adapter.namespace}.${parentId}.\u9999`,
    });
    if ((children == null ? void 0 : children.rows.length) === 0) {
      await adapter.delObjectAsync(parentId);
      adapter.log.debug(`Removed empty parent: ${parentId}`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 &&
  (module.exports = {
    INSTANCE_OBJECT_MIGRATION_PAIRS,
    OBSOLETE_STATE_IDS,
    buildInstanceObjectMigrationPatch,
    runInstanceObjectMigration,
    runObsoleteStateCleanup,
  });
//# sourceMappingURL=migrations.js.map
