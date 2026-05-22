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
var server_exports = {};
__export(server_exports, {
  HueServer: () => import_hue_server.HueServer,
  apiV1Routes: () => import_api_v1_routes.apiV1Routes,
  createSuccessResponse: () => import_error_handler.createSuccessResponse,
  descriptionRoute: () => import_description_route.descriptionRoute,
  hueErrorHandler: () => import_error_handler.hueErrorHandler
});
module.exports = __toCommonJS(server_exports);
var import_hue_server = require("./hue-server");
var import_api_v1_routes = require("./routes/api-v1-routes");
var import_description_route = require("./routes/description-route");
var import_error_handler = require("./middleware/error-handler");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueServer,
  apiV1Routes,
  createSuccessResponse,
  descriptionRoute,
  hueErrorHandler
});
//# sourceMappingURL=index.js.map
