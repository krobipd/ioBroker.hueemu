"use strict";
/**
 * Server module exports
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSuccessResponse = exports.hueErrorHandler = exports.descriptionRoute = exports.apiV1Routes = exports.HueServer = void 0;
var hue_server_1 = require("./hue-server");
Object.defineProperty(exports, "HueServer", { enumerable: true, get: function () { return hue_server_1.HueServer; } });
var api_v1_routes_1 = require("./routes/api-v1-routes");
Object.defineProperty(exports, "apiV1Routes", { enumerable: true, get: function () { return api_v1_routes_1.apiV1Routes; } });
var description_route_1 = require("./routes/description-route");
Object.defineProperty(exports, "descriptionRoute", { enumerable: true, get: function () { return description_route_1.descriptionRoute; } });
var error_handler_1 = require("./middleware/error-handler");
Object.defineProperty(exports, "hueErrorHandler", { enumerable: true, get: function () { return error_handler_1.hueErrorHandler; } });
Object.defineProperty(exports, "createSuccessResponse", { enumerable: true, get: function () { return error_handler_1.createSuccessResponse; } });
