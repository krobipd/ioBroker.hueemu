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
var hue_api_exports = {};
__export(hue_api_exports, {
  ApiHandler: () => import_api_handler.ApiHandler,
  ConfigService: () => import_config_service.ConfigService,
  DeviceBindingService: () => import_device_binding_service.DeviceBindingService,
  UserService: () => import_user_service.UserService
});
module.exports = __toCommonJS(hue_api_exports);
var import_api_handler = require("./api-handler");
var import_user_service = require("./user-service");
var import_config_service = require("./config-service");
var import_device_binding_service = require("./device-binding-service");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApiHandler,
  ConfigService,
  DeviceBindingService,
  UserService
});
//# sourceMappingURL=index.js.map
