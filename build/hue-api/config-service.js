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
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
class ConfigService {
  identity;
  discoveryHost;
  whitelistProvider;
  // Bridge configuration constants
  static SW_VERSION = "1941132080";
  static API_VERSION = "1.41.0";
  static DATASTORE_VERSION = "98";
  static MODEL_ID = import_config.BRIDGE_MODEL_ID;
  static BRIDGE_NAME = "Philips hue";
  constructor(config) {
    this.identity = config.identity;
    this.discoveryHost = config.discoveryHost;
    this.whitelistProvider = config.whitelistProvider;
  }
  /** v1.4.3 (C2): IANA timezone of the host (or UTC if unresolvable). */
  static getHostTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }
  /** v1.4.3 (C3): Hue spec timestamp shape `YYYY-MM-DD HH:MM:SS` in `timezone`. */
  static formatHueTimestamp(date, timezone) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
      return fmt.format(date).replace(", ", " ").replace(",", " ");
    } catch {
      return date.toISOString().replace("T", " ").substring(0, 19);
    }
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
   * Get full bridge configuration (requires auth).
   *
   * v1.4.3 (C1): IPv4-only gateway munge — old `replace(/\.\d+$/, ".1")`
   * produced garbage on IPv6 hosts.
   * v1.4.3 (C2+C3): real timezone + locally-shifted localtime.
   * v1.4.3 (C6): expose paired clients in `whitelist` for spec compliance.
   */
  getFullConfig() {
    const tz = ConfigService.getHostTimezone();
    const now = /* @__PURE__ */ new Date();
    const isIPv4 = IPV4_RE.test(this.discoveryHost);
    const gateway = isIPv4 ? this.discoveryHost.replace(/\.\d+$/, ".1") : this.discoveryHost;
    const whitelist = {};
    if (this.whitelistProvider) {
      try {
        const ids = this.whitelistProvider();
        const ts = ConfigService.formatHueTimestamp(now, "UTC");
        for (const id of ids) {
          whitelist[id] = { name: id, "create date": ts, "last use date": ts };
        }
      } catch {
      }
    }
    return {
      ...this.getConfig(),
      ipaddress: this.discoveryHost,
      netmask: "255.255.255.0",
      gateway,
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
      UTC: ConfigService.formatHueTimestamp(now, "UTC"),
      localtime: ConfigService.formatHueTimestamp(now, tz),
      timezone: tz,
      whitelist
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
