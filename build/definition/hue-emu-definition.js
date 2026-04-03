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
var hue_emu_definition_exports = {};
__export(hue_emu_definition_exports, {
  HueEmuDefinition: () => HueEmuDefinition
});
module.exports = __toCommonJS(hue_emu_definition_exports);
var import_functions = require("./functions");
var import_roles = require("./roles");
class HueEmuDefinition {
  constructor(adapter) {
    this.adapter = adapter;
  }
  chain = Promise.resolve();
  /**
   *
   */
  addFunction(device, channel, state) {
    let name = HueEmuDefinition.determineFunction(channel);
    if (name) {
      name = name.trim().toLowerCase().replace(/ /g, "_");
      if (name && name.length > 0) {
        if (state) {
          this.chain = this.chain.then(
            () => this.adapter.addStateToEnumAsync(
              "functions",
              name,
              device,
              channel,
              state
            )
          );
        } else {
          this.chain = this.chain.then(
            () => this.adapter.addChannelToEnumAsync(
              "functions",
              name,
              device,
              channel
            )
          );
        }
      }
    }
  }
  /**
   * Determine function for channel
   *
   * @param channel to specify function for
   * @returns function
   */
  static determineFunction(channel) {
    const func = import_functions.FUNCTIONS[channel];
    if (func !== null && typeof func !== "undefined") {
      return func;
    }
    return void 0;
  }
  /**
   * Get role of device states
   *
   * @param channel
   *        channel
   * @param key
   *        key of a state
   * @returns role
   */
  static determineRole(channel, key) {
    const roleType = import_roles.ROLES[channel];
    if (roleType !== null && typeof roleType !== "undefined") {
      const role = roleType[key];
      if (role !== null && typeof role !== "undefined") {
        return role;
      }
    }
    return "state";
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueEmuDefinition
});
//# sourceMappingURL=hue-emu-definition.js.map
