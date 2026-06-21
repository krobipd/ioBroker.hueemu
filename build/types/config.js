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
var config_exports = {};
__export(config_exports, {
  BRIDGE_MODEL_ID: () => BRIDGE_MODEL_ID,
  detectPrimaryIPv4: () => detectPrimaryIPv4,
  generateBridgeId: () => generateBridgeId,
  generateSerialNumber: () => generateSerialNumber,
  macFromUdn: () => macFromUdn,
  validateNetworkConfig: () => validateNetworkConfig
});
module.exports = __toCommonJS(config_exports);
var import_node_os = require("node:os");
const BRIDGE_MODEL_ID = "BSB002";
function generateBridgeId(mac) {
  const cleanMac = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return `${cleanMac.slice(0, 6)}FFFE${cleanMac.slice(6)}`;
}
function generateSerialNumber(mac) {
  return mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}
function macFromUdn(udn) {
  const hex = udn.replace(/-/g, "").slice(0, 12).padEnd(12, "0");
  return hex.match(/.{2}/g).join(":");
}
function detectPrimaryIPv4() {
  for (const addrs of Object.values((0, import_node_os.networkInterfaces)())) {
    for (const addr of addrs != null ? addrs : []) {
      const isV4 = addr.family === "IPv4" || addr.family === 4;
      if (isV4 && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "";
}
function validateNetworkConfig(advertiseHost, port, httpsPort) {
  if (!advertiseHost || advertiseHost === "0.0.0.0") {
    throw new Error(
      "Could not determine a routable IP to advertise \u2014 set the advertised IP in admin config to the address clients should reach"
    );
  }
  if (httpsPort !== void 0 && httpsPort === port) {
    throw new Error(`HTTPS port ${httpsPort} equals HTTP port \u2014 pick a different port`);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BRIDGE_MODEL_ID,
  detectPrimaryIPv4,
  generateBridgeId,
  generateSerialNumber,
  macFromUdn,
  validateNetworkConfig
});
//# sourceMappingURL=config.js.map
