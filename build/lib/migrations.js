"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var migrations_exports = {};
__export(migrations_exports, {
  ID_RANGE_END: () => ID_RANGE_END,
  OBSOLETE_STATE_IDS: () => OBSOLETE_STATE_IDS,
  buildDeviceScalePatch: () => buildDeviceScalePatch,
  detectLegacyLightType: () => detectLegacyLightType,
  runDeviceScaleBackfill: () => runDeviceScaleBackfill,
  runLegacyDeviceMigration: () => runLegacyDeviceMigration,
  runObsoleteStateCleanup: () => runObsoleteStateCleanup
});
module.exports = __toCommonJS(migrations_exports);
var import_utils = require("../types/utils");
var import_device_scan = require("./device-scan");
const ID_RANGE_END = "\uFFFF";
function detectLegacyLightType(stateKeys) {
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
const OBSOLETE_STATE_IDS = [
  { id: "info.configuredDevices", removedIn: "1.0.15" },
  { id: "info.connection", removedIn: "1.1.3" },
  { id: "info", removedIn: "1.1.3" },
  { id: "createLight", removedIn: "1.1.0" }
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
      endkey: `${adapter.namespace}.${parentId}.${ID_RANGE_END}`
    });
    if ((children == null ? void 0 : children.rows.length) === 0) {
      await adapter.delObjectAsync(parentId);
      adapter.log.debug(`Removed empty parent: ${parentId}`);
    }
  }
}
async function runLegacyDeviceMigration(adapter) {
  var _a;
  if (adapter.configuredDevices && adapter.configuredDevices.length > 0) {
    return false;
  }
  const devices = await adapter.getDevicesAsync();
  if (devices.length === 0) {
    return false;
  }
  adapter.log.info(`Found ${devices.length} legacy device(s) \u2014 migrating to new configuration`);
  const migratedDevices = [];
  for (const device of devices) {
    const deviceId = device._id.substring(adapter.namespace.length + 1);
    try {
      const nameState = await adapter.getStateAsync(`${deviceId}.name`);
      const nameVal = typeof (nameState == null ? void 0 : nameState.val) === "string" ? nameState.val : void 0;
      const commonName = typeof ((_a = device.common) == null ? void 0 : _a.name) === "string" ? device.common.name : void 0;
      const name = nameVal || commonName || deviceId;
      const stateObjects = await adapter.getStatesOfAsync(deviceId, "state");
      const stateKeys = new Set((stateObjects || []).map((s) => s._id.substring(s._id.lastIndexOf(".") + 1)));
      const lightType = detectLegacyLightType(stateKeys);
      const config = { name, lightType };
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
      await Promise.all([
        adapter.delObjectAsync(`${deviceId}.name`).catch(() => {
        }),
        adapter.delObjectAsync(`${deviceId}.data`).catch(() => {
        })
      ]);
    } catch (error) {
      adapter.log.warn(`Could not migrate legacy device ${deviceId}: ${(0, import_utils.errText)(error)}`);
    }
  }
  if (migratedDevices.length === 0) {
    return false;
  }
  await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
    native: { devices: migratedDevices }
  });
  adapter.log.info(`Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`);
  return true;
}
function buildDeviceScalePatch(device, facts) {
  const patch = {};
  if (device.briState && !device.briScale) {
    const scale = (0, import_device_scan.deriveLevelScale)(facts.bri);
    if (scale) {
      patch.briScale = scale;
    }
  }
  if (device.satState && !device.satScale) {
    const scale = (0, import_device_scan.deriveLevelScale)(facts.sat);
    if (scale) {
      patch.satScale = scale;
    }
  }
  if (device.hueState && !device.hueScale) {
    const scale = (0, import_device_scan.deriveHueScale)(facts.hue);
    if (scale) {
      patch.hueScale = scale;
    }
  }
  if (device.ctState && !device.ctScale) {
    const scale = (0, import_device_scan.deriveCtScale)(facts.ct);
    if (scale) {
      patch.ctScale = scale;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}
async function runDeviceScaleBackfill(adapter, devices) {
  if (!devices.length) {
    return false;
  }
  const factsFor = async (id) => {
    if (!id) {
      return void 0;
    }
    try {
      return (0, import_device_scan.stateFactsOf)(await adapter.getForeignObjectAsync(id));
    } catch (error) {
      adapter.log.debug(`Scale backfill: could not read ${id}: ${(0, import_utils.errText)(error)}`);
      return void 0;
    }
  };
  const patched = [];
  let changed = 0;
  for (const device of devices) {
    const patch = buildDeviceScalePatch(device, {
      bri: await factsFor(device.briState),
      sat: await factsFor(device.satState),
      hue: await factsFor(device.hueState),
      ct: await factsFor(device.ctState)
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
    `Determined the value scale for ${changed} configured light(s) from their source states. Adapter will restart.`
  );
  return true;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ID_RANGE_END,
  OBSOLETE_STATE_IDS,
  buildDeviceScalePatch,
  detectLegacyLightType,
  runDeviceScaleBackfill,
  runLegacyDeviceMigration,
  runObsoleteStateCleanup
});
//# sourceMappingURL=migrations.js.map
