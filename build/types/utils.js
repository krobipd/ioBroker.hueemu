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
var utils_exports = {};
__export(utils_exports, {
  errText: () => errText,
  oneLine: () => oneLine,
  sanitizeId: () => sanitizeId
});
module.exports = __toCommonJS(utils_exports);
function sanitizeId(id) {
  return id.replace(/[^A-Za-z0-9\-_]/g, "_");
}
function errText(err) {
  var _a;
  if (err instanceof Error) {
    return err.message;
  }
  if (err === null) {
    return "null";
  }
  if (err === void 0) {
    return "undefined";
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") {
    return err.toString();
  }
  try {
    return (_a = JSON.stringify(err)) != null ? _a : Object.prototype.toString.call(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}
function oneLine(s) {
  var _a;
  let out = "";
  for (const ch of s) {
    const code = (_a = ch.codePointAt(0)) != null ? _a : 0;
    out += code < 32 || code === 127 ? " " : ch;
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  errText,
  oneLine,
  sanitizeId
});
//# sourceMappingURL=utils.js.map
