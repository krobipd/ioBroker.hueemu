/**
 * Hue Emulator HTTP/HTTPS Server using Fastify
 */

import type { FastifyHttpsOptions, FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import type { Server as HttpsServer } from "node:https";
import type { HueEmulatorConfig, Logger, HueApiHandler } from "../types";
import { descriptionRoute } from "./routes/description-route";
import { apiV1Routes } from "./routes/api-v1-routes";
import { createHueErrorHandler } from "./middleware/error-handler";

/**
 * Options for creating the Hue server
 */
export interface HueServerOptions {
  /** Emulator configuration */
  config: HueEmulatorConfig;
  /** API handler implementation */
  handler: HueApiHandler;
  /** Logger */
  logger: Logger;
}

/**
 * Hue Emulator Server
 * Provides HTTP (and optionally HTTPS) endpoints for Hue API emulation
 */
export class HueServer {
  private httpServer: FastifyInstance | null = null;
  private httpsServer: FastifyInstance | null = null;
  private readonly config: HueEmulatorConfig;
  private readonly handler: HueApiHandler;
  private readonly logger: Logger;

  /**
   * Create a new Hue emulator server
   *
   * @param options - Server options
   */
  constructor(options: HueServerOptions) {
    this.config = options.config;
    this.handler = options.handler;
    this.logger = options.logger;
  }

  /**
   * Start the HTTP server (and HTTPS if configured)
   */
  public async start(): Promise<void> {
    // Start HTTP server
    this.httpServer = await this.createServer(false);
    await this.httpServer.listen({
      port: this.config.port,
      host: this.config.host || "0.0.0.0",
    });

    this.logger.debug(`HTTP server listening on ${this.config.host}:${this.config.port}`);

    // Start HTTPS server if configured
    if (this.config.https) {
      this.httpsServer = await this.createServer(true);
      await this.httpsServer.listen({
        port: this.config.https.port,
        host: this.config.host || "0.0.0.0",
      });

      this.logger.debug(`HTTPS server listening on ${this.config.host}:${this.config.https.port}`);
    }
  }

  /**
   * Stop all servers
   */
  public async stop(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.httpServer) {
      promises.push(this.httpServer.close());
    }

    if (this.httpsServer) {
      promises.push(this.httpsServer.close());
    }

    await Promise.all(promises);
    this.logger.debug("All servers stopped");
  }

  /**
   * Create a Fastify server instance — HTTP or HTTPS based on flag.
   *
   * @param https - Whether to create an HTTPS server
   */
  private async createServer(https: boolean): Promise<FastifyInstance> {
    // v1.4.3 (SV1): trustProxy is opt-in via admin config — was unconditional
    // true. With trustProxy=true any client can spoof `req.ip`/`req.protocol`
    // by sending X-Forwarded-* headers, which then ends up in our debug logs.
    // Only safe behind a TLS-terminating reverse proxy that strips those
    // headers from inbound traffic. Mirrors the hassemu C11 (v1.25.0) decision.
    //
    // v1.4.3 (SV3): bodyLimit reduced from 1 MiB to 64 KiB. Hue API request
    // bodies are tiny (light state JSON ~200 bytes). 1 MiB invited DoS via
    // large POSTs.
    //
    // v1.4.3 (SV5): forceCloseConnections so keepalive Hue clients don't
    // wedge the server during shutdown.
    const baseOptions = {
      logger: false as const,
      trustProxy: this.config.trustProxy === true,
      bodyLimit: 65536,
      caseSensitive: false,
      ignoreTrailingSlash: true,
      forceCloseConnections: true as const,
    };

    let server: FastifyInstance;
    if (https && this.config.https) {
      const httpsOptions: FastifyHttpsOptions<HttpsServer> = {
        ...baseOptions,
        https: {
          key: this.config.https.key,
          cert: this.config.https.cert,
        },
      };
      server = Fastify(httpsOptions);
    } else {
      const httpOptions: FastifyServerOptions = baseOptions;
      server = Fastify(httpOptions);
    }

    // Register error handler (v1.4.5 (I): factory wires debug-trace for every
    // converged Fastify error — validation/parse-fail/internal/Hue-typed)
    server.setErrorHandler(createHueErrorHandler(this.logger));

    // Add request logging
    server.addHook("onRequest", async (request, _reply) => {
      this.logger.debug(`${request.method} ${request.url} [${request.ip}]`);
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
    await server.register(descriptionRoute, {
      descriptionOptions: {
        identity: this.config.identity,
        host: this.config.discoveryHost || this.config.host,
        port: this.config.discoveryPort || this.config.port,
      },
    });

    // Register API routes (v1.4.5 (I): logger pass-through enables
    // handleErrors debug-trace for route-level exceptions)
    await server.register(apiV1Routes, {
      handler: this.handler,
      logger: this.logger,
    });

    // Health check endpoint
    server.get("/health", () => ({ status: "ok" }));

    return server;
  }
}
