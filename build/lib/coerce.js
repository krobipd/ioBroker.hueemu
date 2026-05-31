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
var coerce_exports = {};
__export(coerce_exports, {
  coerceBool: () => coerceBool,
  coerceFiniteNumber: () => coerceFiniteNumber,
  parseLightIndex: () => parseLightIndex,
  parsePort: () => parsePort
});
module.exports = __toCommonJS(coerce_exports);
function coerceFiniteNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function coerceBool(v) {
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "on";
  }
  return false;
}
function parseLightIndex(id, max) {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(id)) {
    return null;
  }
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    return null;
  }
  return n - 1;
}
function parsePort(port) {
  if (typeof port === "number") {
    return Number.isFinite(port) ? port : void 0;
  }
  if (typeof port === "string" && port.trim().length > 0) {
    const n = parseInt(port.trim(), 10);
    return Number.isFinite(n) ? n : void 0;
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  coerceBool,
  coerceFiniteNumber,
  parseLightIndex,
  parsePort
});
//# sourceMappingURL=coerce.js.map
