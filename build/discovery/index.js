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
var discovery_exports = {};
__export(discovery_exports, {
  HueSsdpServer: () => import_ssdp_server.HueSsdpServer,
  generateDescriptionXml: () => import_description_xml.generateDescriptionXml,
  getDescriptionUrl: () => import_description_xml.getDescriptionUrl
});
module.exports = __toCommonJS(discovery_exports);
var import_ssdp_server = require("./ssdp-server");
var import_description_xml = require("./description-xml");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueSsdpServer,
  generateDescriptionXml,
  getDescriptionUrl
});
//# sourceMappingURL=index.js.map
