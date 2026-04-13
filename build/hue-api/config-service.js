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
var config_service_exports = {};
__export(config_service_exports, {
  ConfigService: () => ConfigService
});
module.exports = __toCommonJS(config_service_exports);
var import_config = require("../types/config");
class ConfigService {
  identity;
  discoveryHost;
  // Bridge configuration constants
  static SW_VERSION = "1941132080";
  static API_VERSION = "1.41.0";
  static DATASTORE_VERSION = "98";
  static MODEL_ID = import_config.BRIDGE_MODEL_ID;
  static BRIDGE_NAME = "Philips hue";
  constructor(config) {
    this.identity = config.identity;
    this.discoveryHost = config.discoveryHost;
  }
  /**
   * Get public bridge configuration (no auth required)
   */
  getConfig() {
    return {
      name: ConfigService.BRIDGE_NAME,
      datastoreversion: ConfigService.DATASTORE_VERSION,
      swversion: ConfigService.SW_VERSION,
      apiversion: ConfigService.API_VERSION,
      mac: this.identity.mac,
      bridgeid: this.identity.bridgeId,
      factorynew: false,
      replacesbridgeid: null,
      modelid: ConfigService.MODEL_ID,
      starterkitid: ""
    };
  }
  /**
   * Get full bridge configuration (requires auth)
   */
  getFullConfig() {
    return {
      ...this.getConfig(),
      ipaddress: this.discoveryHost,
      netmask: "255.255.255.0",
      gateway: this.discoveryHost.replace(/\.\d+$/, ".1"),
      dhcp: true,
      portalservices: true,
      portalconnection: "connected",
      portalstate: {
        signedon: true,
        incoming: false,
        outgoing: true,
        communication: "disconnected"
      },
      linkbutton: false,
      touchlink: false,
      zigbeechannel: 20,
      UTC: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 19),
      localtime: (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 19),
      timezone: "Europe/Berlin",
      whitelist: {}
    };
  }
  /**
   * Build full state response
   */
  buildFullState(lights) {
    return {
      lights,
      groups: {},
      config: this.getFullConfig(),
      schedules: {},
      scenes: {},
      rules: {},
      sensors: {},
      resourcelinks: {}
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ConfigService
});
//# sourceMappingURL=config-service.js.map
