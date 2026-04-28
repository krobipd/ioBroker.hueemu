"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hue_server_exports = {};
__export(hue_server_exports, {
  HueServer: () => HueServer
});
module.exports = __toCommonJS(hue_server_exports);
var import_fastify = __toESM(require("fastify"));
var import_description_route = require("./routes/description-route");
var import_api_v1_routes = require("./routes/api-v1-routes");
var import_error_handler = require("./middleware/error-handler");
class HueServer {
  httpServer = null;
  httpsServer = null;
  config;
  handler;
  logger;
  constructor(options) {
    this.config = options.config;
    this.handler = options.handler;
    this.logger = options.logger;
  }
  /**
   * Start the HTTP server (and HTTPS if configured)
   */
  async start() {
    this.httpServer = await this.createServer(false);
    await this.httpServer.listen({
      port: this.config.port,
      host: this.config.host || "0.0.0.0"
    });
    this.log("debug", `HTTP server listening on ${this.config.host}:${this.config.port}`);
    if (this.config.https) {
      this.httpsServer = await this.createServer(true);
      await this.httpsServer.listen({
        port: this.config.https.port,
        host: this.config.host || "0.0.0.0"
      });
      this.log("debug", `HTTPS server listening on ${this.config.host}:${this.config.https.port}`);
    }
  }
  /**
   * Stop all servers
   */
  async stop() {
    const promises = [];
    if (this.httpServer) {
      promises.push(this.httpServer.close());
    }
    if (this.httpsServer) {
      promises.push(this.httpsServer.close());
    }
    await Promise.all(promises);
    this.log("debug", "All servers stopped");
  }
  /**
   * Create a Fastify server instance
   */
  async createServer(https) {
    const options = {
      logger: false,
      // We use our own logger
      trustProxy: true,
      bodyLimit: 1048576,
      // 1MB
      caseSensitive: false,
      ignoreTrailingSlash: true
    };
    if (https && this.config.https) {
      options.https = {
        key: this.config.https.key,
        cert: this.config.https.cert
      };
    }
    const server = (0, import_fastify.default)(options);
    server.setErrorHandler(import_error_handler.hueErrorHandler);
    server.addHook("onRequest", async (request, _reply) => {
      this.log("debug", `${request.method} ${request.url} [${request.ip}]`);
    });
    server.addHook("onSend", async (_request, reply, payload) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      return payload;
    });
    server.options("*", async (_request, reply) => {
      reply.status(204).send();
    });
    await server.register(import_description_route.descriptionRoute, {
      descriptionOptions: {
        identity: this.config.identity,
        host: this.config.discoveryHost || this.config.host,
        port: this.config.discoveryPort || this.config.port
      }
    });
    await server.register(import_api_v1_routes.apiV1Routes, {
      handler: this.handler
    });
    server.get("/health", async () => ({ status: "ok" }));
    return server;
  }
  log(level, message) {
    this.logger[level](message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueServer
});
//# sourceMappingURL=hue-server.js.map
