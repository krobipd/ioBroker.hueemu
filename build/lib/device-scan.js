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
  deriveCtScale: () => deriveCtScale,
  deriveHueScale: () => deriveHueScale,
  deriveLevelScale: () => deriveLevelScale,
  mapControlToDevice: () => mapControlToDevice,
  scanForLightDevices: () => scanForLightDevices,
  stateFactsOf: () => stateFactsOf
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
const MAX_MATCH_TOLERANCE = 0.5;
function isAbout(actual, expected) {
  return actual !== void 0 && Math.abs(actual - expected) <= MAX_MATCH_TOLERANCE;
}
function normalizeUnit(unit) {
  return (unit != null ? unit : "").trim().toLowerCase();
}
const DEGREE_UNITS = /* @__PURE__ */ new Set(["\xB0", "deg", "deg.", "degree", "degrees", "grad"]);
const KELVIN_UNITS = /* @__PURE__ */ new Set(["k", "\xB0k", "kelvin"]);
const MIRED_UNITS = /* @__PURE__ */ new Set(["mired", "mireds", "mirek", "mk^-1"]);
function deriveLevelScale(facts) {
  if (!facts) {
    return void 0;
  }
  if (normalizeUnit(facts.unit) === "%") {
    return "percent";
  }
  if (isAbout(facts.max, 100)) {
    return "percent";
  }
  if (isAbout(facts.max, 1)) {
    return "normalized";
  }
  if (isAbout(facts.max, 254) || isAbout(facts.max, 255)) {
    return "raw";
  }
  return void 0;
}
function deriveHueScale(facts) {
  if (!facts) {
    return void 0;
  }
  if (DEGREE_UNITS.has(normalizeUnit(facts.unit))) {
    return "degrees";
  }
  if (isAbout(facts.max, 360)) {
    return "degrees";
  }
  if (isAbout(facts.max, 65535) || isAbout(facts.max, 65534)) {
    return "raw";
  }
  return void 0;
}
const KELVIN_MIN_PLAUSIBLE_MAX = 1e3;
function deriveCtScale(facts) {
  if (!facts) {
    return void 0;
  }
  const unit = normalizeUnit(facts.unit);
  if (KELVIN_UNITS.has(unit)) {
    return "kelvin";
  }
  if (MIRED_UNITS.has(unit)) {
    return "raw";
  }
  if (facts.max !== void 0 && facts.max >= KELVIN_MIN_PLAUSIBLE_MAX) {
    return "kelvin";
  }
  return void 0;
}
function deriveScales(device, lookup) {
  const briScale = device.briState ? deriveLevelScale(lookup(device.briState)) : void 0;
  const satScale = device.satState ? deriveLevelScale(lookup(device.satState)) : void 0;
  const hueScale = device.hueState ? deriveHueScale(lookup(device.hueState)) : void 0;
  const ctScale = device.ctState ? deriveCtScale(lookup(device.ctState)) : void 0;
  return {
    ...device,
    ...briScale ? { briScale } : {},
    ...satScale ? { satScale } : {},
    ...hueScale ? { hueScale } : {},
    ...ctScale ? { ctScale } : {}
  };
}
function firstWritable(by, names, lookup) {
  var _a;
  for (const name of names) {
    const id = by.get(name);
    if (id && ((_a = lookup(id)) == null ? void 0 : _a.writable)) {
      return id;
    }
  }
  return void 0;
}
function mapControlToDevice(type, states, name, lookup) {
  var _a;
  const by = statesByName(states);
  const on = firstWritable(by, ["ON_SET", "ON", "ON_ACTUAL"], lookup);
  const bri = firstWritable(by, ["DIMMER", "BRIGHTNESS"], lookup);
  const ifDrivable = (device) => device.onState || device.briState ? { kind: "device", device: deriveScales(device, lookup) } : { kind: "unmapped", reason: "noWritableTarget" };
  switch (type) {
    case import_type_detector.Types.light: {
      const set = firstWritable(by, ["SET"], lookup);
      return set ? { kind: "device", device: { name, lightType: "onoff", onState: set } } : { kind: "unmapped", reason: "noWritableTarget" };
    }
    case import_type_detector.Types.dimmer: {
      const level = (_a = firstWritable(by, ["SET"], lookup)) != null ? _a : bri;
      return ifDrivable({ name, lightType: "dimmable", onState: on, briState: level });
    }
    case import_type_detector.Types.ct:
      return ifDrivable({
        name,
        lightType: "ct",
        onState: on,
        briState: bri,
        ctState: firstWritable(by, ["TEMPERATURE"], lookup)
      });
    case import_type_detector.Types.hue:
      return ifDrivable({
        name,
        lightType: "color",
        onState: on,
        briState: bri,
        hueState: firstWritable(by, ["HUE"], lookup),
        satState: firstWritable(by, ["SATURATION"], lookup),
        // The `hue` pattern carries TEMPERATURE too, and `lightType: "color"`
        // has a ct slot — leaving it unmapped made every scanned colour light
        // report the 250-mired placeholder for ever (2026-09-03 audit, F2).
        ctState: firstWritable(by, ["TEMPERATURE"], lookup)
      });
    case import_type_detector.Types.cie:
      return ifDrivable({
        name,
        lightType: "color",
        onState: on,
        briState: bri,
        xyState: firstWritable(by, ["CIE"], lookup),
        ctState: firstWritable(by, ["TEMPERATURE"], lookup)
      });
    default:
      return { kind: "unmapped", reason: "rgbChannel" };
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
function stateFactsOf(obj) {
  if ((obj == null ? void 0 : obj.type) !== "state") {
    return void 0;
  }
  const common = obj.common;
  return {
    // Only an explicit `false` disqualifies: plenty of adapters omit the flag on
    // states that are perfectly writable.
    writable: common.write !== false,
    min: typeof common.min === "number" ? common.min : void 0,
    max: typeof common.max === "number" ? common.max : void 0,
    unit: typeof common.unit === "string" ? common.unit : void 0
  };
}
function scanForLightDevices(objects, nameOf) {
  const detector = new import_type_detector.default();
  const keys = Object.keys(objects).sort();
  const devices = [];
  const unmapped = [];
  const usedIds = [];
  const lookup = (id) => stateFactsOf(objects[id]);
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
      const outcome = mapControlToDevice(control.type, control.states || [], nameOf(id, obj), lookup);
      if (outcome.kind === "device") {
        devices.push(outcome.device);
      } else {
        unmapped.push({ id, type: control.type, reason: outcome.reason });
      }
    }
  }
  return { devices, unmapped };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  deriveCtScale,
  deriveHueScale,
  deriveLevelScale,
  mapControlToDevice,
  scanForLightDevices,
  stateFactsOf
});
//# sourceMappingURL=device-scan.js.map
