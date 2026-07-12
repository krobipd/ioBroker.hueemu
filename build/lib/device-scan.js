"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var device_scan_exports = {};
__export(device_scan_exports, {
  mapControlToDevice: () => mapControlToDevice,
  scanForLightDevices: () => scanForLightDevices
});
module.exports = __toCommonJS(device_scan_exports);
var import_type_detector = __toESM(require("@iobroker/type-detector"));
function statesByName(states) {
  const map = /* @__PURE__ */ new Map();
  for (const s of states) {
    if (s.id) {
      if (!map.has(s.name)) {
        map.set(s.name, s.id);
      }
    }
  }
  return map;
}
function mapControlToDevice(type, states, name) {
  var _a, _b, _c, _d;
  const by = statesByName(states);
  const on = (_b = (_a = by.get("ON_SET")) != null ? _a : by.get("ON")) != null ? _b : by.get("ON_ACTUAL");
  const bri = (_c = by.get("DIMMER")) != null ? _c : by.get("BRIGHTNESS");
  switch (type) {
    case import_type_detector.Types.light:
      return by.get("SET") ? { name, lightType: "onoff", onState: by.get("SET") } : null;
    case import_type_detector.Types.dimmer:
      return on ? { name, lightType: "dimmable", onState: on, briState: (_d = by.get("SET")) != null ? _d : bri } : null;
    case import_type_detector.Types.ct:
      return on ? { name, lightType: "ct", onState: on, briState: bri, ctState: by.get("TEMPERATURE") } : null;
    case import_type_detector.Types.hue:
      return on ? {
        name,
        lightType: "color",
        onState: on,
        briState: bri,
        hueState: by.get("HUE"),
        satState: by.get("SATURATION")
      } : null;
    case import_type_detector.Types.cie:
      return on ? { name, lightType: "color", onState: on, briState: bri, xyState: by.get("CIE") } : null;
    default:
      return null;
  }
}
const DETECTABLE_LIGHT_TYPES = /* @__PURE__ */ new Set([
  import_type_detector.Types.light,
  import_type_detector.Types.dimmer,
  import_type_detector.Types.ct,
  import_type_detector.Types.hue,
  import_type_detector.Types.cie,
  import_type_detector.Types.rgb,
  import_type_detector.Types.rgbSingle,
  import_type_detector.Types.rgbwSingle
]);
function scanForLightDevices(objects, nameOf) {
  const detector = new import_type_detector.default();
  const keys = Object.keys(objects).sort();
  const devices = [];
  const unmapped = [];
  const usedIds = [];
  for (const id of keys) {
    const obj = objects[id];
    if ((obj == null ? void 0 : obj.type) !== "device" && (obj == null ? void 0 : obj.type) !== "channel") {
      continue;
    }
    let controls;
    try {
      controls = detector.detect({ objects, id, _keysOptional: keys, _usedIdsOptional: usedIds });
    } catch {
      continue;
    }
    if (!controls) {
      continue;
    }
    for (const control of controls) {
      if (!DETECTABLE_LIGHT_TYPES.has(control.type)) {
        continue;
      }
      const device = mapControlToDevice(control.type, control.states || [], nameOf(id, obj));
      if (device) {
        devices.push(device);
      } else if (control.type === import_type_detector.Types.rgb || control.type === import_type_detector.Types.rgbSingle || control.type === import_type_detector.Types.rgbwSingle) {
        unmapped.push({ id, type: control.type });
      }
    }
  }
  return { devices, unmapped };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mapControlToDevice,
  scanForLightDevices
});
//# sourceMappingURL=device-scan.js.map
