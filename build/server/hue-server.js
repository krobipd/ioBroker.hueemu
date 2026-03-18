"use strict";
/**
 * Hue Emulator HTTP/HTTPS Server using Fastify
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HueServer = void 0;
const fastify_1 = require("fastify");
const description_route_1 = require("./routes/description-route");
const api_v1_routes_1 = require("./routes/api-v1-routes");
const error_handler_1 = require("./middleware/error-handler");
/**
 * Hue Emulator Server
 * Provides HTTP (and optionally HTTPS) endpoints for Hue API emulation
 */
class HueServer {
    /**
     *
     */
    constructor(options) {
        this.httpServer = null;
        this.httpsServer = null;
        this.config = options.config;
        this.handler = options.handler;
        this.logger = options.logger;
    }
    /**
     * Start the HTTP server (and HTTPS if configured)
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            // Start HTTP server
            this.httpServer = yield this.createServer(false);
            yield this.httpServer.listen({
                port: this.config.port,
                host: this.config.host || "0.0.0.0",
            });
            this.log("info", `HTTP server listening on ${this.config.host}:${this.config.port}`);
            // Start HTTPS server if configured
            if (this.config.https) {
                this.httpsServer = yield this.createServer(true);
                yield this.httpsServer.listen({
                    port: this.config.https.port,
                    host: this.config.host || "0.0.0.0",
                });
                this.log("info", `HTTPS server listening on ${this.config.host}:${this.config.https.port}`);
            }
        });
    }
    /**
     * Stop all servers
     */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            const promises = [];
            if (this.httpServer) {
                promises.push(this.httpServer.close());
            }
            if (this.httpsServer) {
                promises.push(this.httpsServer.close());
            }
            yield Promise.all(promises);
            this.log("info", "All servers stopped");
        });
    }
    /**
     * Create a Fastify server instance
     */
    createServer(https) {
        return __awaiter(this, void 0, void 0, function* () {
            const options = {
                logger: false, // We use our own logger
                trustProxy: true,
                bodyLimit: 1048576, // 1MB
                caseSensitive: false,
                ignoreTrailingSlash: true,
            };
            // Add HTTPS options if needed
            if (https && this.config.https) {
                options.https = {
                    key: this.config.https.key,
                    cert: this.config.https.cert,
                };
            }
            const server = (0, fastify_1.default)(options);
            // Register error handler
            server.setErrorHandler(error_handler_1.hueErrorHandler);
            // Add request logging
            server.addHook("onRequest", (request, _reply) => __awaiter(this, void 0, void 0, function* () {
                this.log("debug", `${request.method} ${request.url}`);
            }));
            // Add CORS headers for Hue API compatibility
            server.addHook("onSend", (request, reply, payload) => __awaiter(this, void 0, void 0, function* () {
                reply.header("Access-Control-Allow-Origin", "*");
                reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
                reply.header("Access-Control-Allow-Headers", "Content-Type");
                return payload;
            }));
            // Handle OPTIONS requests for CORS
            server.options("*", (request, reply) => __awaiter(this, void 0, void 0, function* () {
                reply.status(204).send();
            }));
            // Register description.xml route
            yield server.register(description_route_1.descriptionRoute, {
                descriptionOptions: {
                    identity: this.config.identity,
                    host: this.config.discoveryHost || this.config.host,
                    port: this.config.discoveryPort || this.config.port,
                },
            });
            // Register API routes
            yield server.register(api_v1_routes_1.apiV1Routes, {
                handler: this.handler,
            });
            // Health check endpoint
            server.get("/health", () => __awaiter(this, void 0, void 0, function* () { return ({ status: "ok" }); }));
            return server;
        });
    }
    /**
     * Log a message
     */
    log(level, message) {
        if (this.logger) {
            this.logger[level](message);
        }
    }
}
exports.HueServer = HueServer;
