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
var roles_exports = {};
__export(roles_exports, {
  ROLES: () => ROLES
});
module.exports = __toCommonJS(roles_exports);
const ROLES = {
  state: {
    on: "switch.light",
    reachable: "indicator.reachable",
    mode: "text",
    alert: "text",
    colormode: "text",
    bri: "level.dimmer",
    // TODO: not sure if this is suitable
    ct: "level.color.temperature",
    hue: "level.color.hue",
    sat: "level.color.saturation",
    effect: "text"
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ROLES
});
//# sourceMappingURL=roles.js.map
