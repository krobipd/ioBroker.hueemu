"use strict";
/**
 * Hue Emulator HTTP/HTTPS Server using Fastify
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HueServer = void 0;
const fastify_1 = __importDefault(require("fastify"));
const description_route_1 = require("./routes/description-route");
const api_v1_routes_1 = require("./routes/api-v1-routes");
const error_handler_1 = require("./middleware/error-handler");
/**
 * Hue Emulator Server
 * Provides HTTP (and optionally HTTPS) endpoints for Hue API emulation
 */
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
        // Start HTTP server
        this.httpServer = await this.createServer(false);
        await this.httpServer.listen({
            port: this.config.port,
            host: this.config.host || "0.0.0.0",
        });
        this.log("debug", `HTTP server listening on ${this.config.host}:${this.config.port}`);
        // Start HTTPS server if configured
        if (this.config.https) {
            this.httpsServer = await this.createServer(true);
            await this.httpsServer.listen({
                port: this.config.https.port,
                host: this.config.host || "0.0.0.0",
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
        server.addHook("onRequest", async (request, _reply) => {
            this.log("debug", `${request.method} ${request.url} [${request.ip}]`);
        });
        // Add CORS headers for Hue API compatibility
        server.addHook("onSend", async (_request, reply, payload) => {
            reply.header("Access-Control-Allow-Origin", "*");
            reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            reply.header("Access-Control-Allow-Headers", "Content-Type");
            return payload;
        });
        // Handle OPTIONS requests for CORS
        server.options("*", async (_request, reply) => {
            reply.status(204).send();
        });
        // Register description.xml route
        await server.register(description_route_1.descriptionRoute, {
            descriptionOptions: {
                identity: this.config.identity,
                host: this.config.discoveryHost || this.config.host,
                port: this.config.discoveryPort || this.config.port,
            },
        });
        // Register API routes
        await server.register(api_v1_routes_1.apiV1Routes, {
            handler: this.handler,
        });
        // Health check endpoint
        server.get("/health", async () => ({ status: "ok" }));
        return server;
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
//# sourceMappingURL=hue-server.js.map