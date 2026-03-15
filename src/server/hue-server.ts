/**
 * Hue Emulator HTTP/HTTPS Server using Fastify
 */

import type { FastifyInstance, FastifyServerOptions } from "fastify";
import Fastify from "fastify";
import type { HueEmulatorConfig, Logger, HueApiHandler } from "../types";
import { descriptionRoute } from "./routes/description-route";
import { apiV1Routes } from "./routes/api-v1-routes";
import { hueErrorHandler } from "./middleware/error-handler";

/**
 * Options for creating the Hue server
 */
export interface HueServerOptions {
  /** Emulator configuration */
  config: HueEmulatorConfig;
  /** API handler implementation */
  handler: HueApiHandler;
  /** Optional logger */
  logger?: Logger;
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
  private readonly logger?: Logger;

  /**
   *
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

    this.log(
      "info",
      `HTTP server listening on ${this.config.host}:${this.config.port}`,
    );

    // Start HTTPS server if configured
    if (this.config.https) {
      this.httpsServer = await this.createServer(true);
      await this.httpsServer.listen({
        port: this.config.https.port,
        host: this.config.host || "0.0.0.0",
      });

      this.log(
        "info",
        `HTTPS server listening on ${this.config.host}:${this.config.https.port}`,
      );
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
    this.log("info", "All servers stopped");
  }

  /**
   * Create a Fastify server instance
   */
  private async createServer(https: boolean): Promise<FastifyInstance> {
    const options: FastifyServerOptions = {
      logger: false, // We use our own logger
      trustProxy: true,
      bodyLimit: 1048576, // 1MB
      caseSensitive: false,
      ignoreTrailingSlash: true,
    };

    // Add HTTPS options if needed
    if (https && this.config.https) {
      (options as any).https = {
        key: this.config.https.key,
        cert: this.config.https.cert,
      };
    }

    const server = Fastify(options);

    // Register error handler
    server.setErrorHandler(hueErrorHandler);

    // Add request logging
    server.addHook("onRequest", async (request, _reply) => {
      this.log("debug", `${request.method} ${request.url}`);
    });

    // Add CORS headers for Hue API compatibility
    server.addHook("onSend", async (request, reply, payload) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      return payload;
    });

    // Handle OPTIONS requests for CORS
    server.options("*", async (request, reply) => {
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

    // Register API routes
    await server.register(apiV1Routes, {
      handler: this.handler,
    });

    // Health check endpoint
    server.get("/health", async () => ({ status: "ok" }));

    return server;
  }

  /**
   * Log a message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    if (this.logger) {
      this.logger[level](message);
    }
  }

  /**
   * Get the HTTP server instance
   */
  public get http(): FastifyInstance | null {
    return this.httpServer;
  }

  /**
   * Get the HTTPS server instance
   */
  public get https(): FastifyInstance | null {
    return this.httpsServer;
  }
}
