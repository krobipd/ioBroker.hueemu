/**
 * SSDP Server wrapper for Hue Bridge Discovery
 * Uses node-ssdp for UPnP/SSDP communication
 */

import { Server as SsdpServer } from "node-ssdp";
import type { BridgeIdentity, Logger } from "../types/config";
import { getDescriptionUrl } from "./description-xml";

// Extended server options including sourcePort
interface ExtendedServerOptions {
  location: string;
  sourcePort?: number;
  adInterval?: number;
  ttl?: number;
  allowWildcards?: boolean;
  suppressRootDeviceAdvertisements?: boolean;
  headers?: Record<string, string>;
  udn?: string;
}

/**
 * Configuration for the SSDP discovery server
 */
export interface SsdpServerConfig {
  /** Bridge identity */
  identity: BridgeIdentity;
  /** Host address for discovery */
  host: string;
  /** HTTP port where description.xml is served */
  port: number;
  /** SSDP port (default: 1900) */
  ssdpPort?: number;
  /** Optional logger */
  logger?: Logger;
}

/**
 * SSDP Discovery Server for Hue Bridge emulation
 */
export class HueSsdpServer {
  private server: SsdpServer | null = null;
  private readonly config: Required<Omit<SsdpServerConfig, "logger">> & {
    logger?: Logger;
  };
  private isRunning = false;

  constructor(config: SsdpServerConfig) {
    this.config = {
      ...config,
      ssdpPort: config.ssdpPort ?? 1900,
    };
  }

  /**
   * Start the SSDP server and begin advertising
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.log("debug", "SSDP server already running");
      return;
    }

    try {
      const location = getDescriptionUrl(this.config.host, this.config.port);

      const serverOptions: ExtendedServerOptions = {
        location,
        sourcePort: this.config.ssdpPort,
        adInterval: 10000, // Advertise every 10 seconds
        ttl: 4,
        allowWildcards: true,
        suppressRootDeviceAdvertisements: false,
        headers: {
          "hue-bridgeid": this.config.identity.bridgeId,
          SERVER: "Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0",
        },
        udn: `uuid:${this.config.identity.udn}`,
      };

      this.server = new SsdpServer(serverOptions as any);

      // Add the Basic device type that Hue apps search for
      // Register both cases since some clients (e.g. Harmony Hub) use lowercase
      this.server.addUSN("urn:schemas-upnp-org:device:Basic:1");
      this.server.addUSN("urn:schemas-upnp-org:device:basic:1");
      this.server.addUSN("upnp:rootdevice");

      // Handle errors - use type assertion as node-ssdp types may not include all events
      (this.server as any).on("error", (err: Error) => {
        this.log("error", `SSDP error: ${err.message}`);
      });

      // Start the server
      await new Promise<void>((resolve, reject) => {
        if (!this.server) {
          reject(new Error("Server not initialized"));
          return;
        }

        void this.server.start((err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = true;
      this.log(
        "debug",
        `SSDP server started on port ${this.config.ssdpPort}, advertising at ${location}`,
      );
    } catch (error) {
      this.log("error", `Failed to start SSDP server: ${error}`);
      throw error;
    }
  }

  /**
   * Stop the SSDP server
   */
  public stop(): void {
    if (this.server && this.isRunning) {
      this.server.stop();
      this.isRunning = false;
      this.log("info", "SSDP server stopped");
    }
  }

  /**
   * Send an SSDP notify message
   */
  public notify(): void {
    if (this.server && this.isRunning) {
      // Trigger an immediate advertisement
      this.log("debug", "Sending SSDP notify");
    }
  }

  /**
   * Check if server is running
   */
  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Log a message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    if (this.config.logger) {
      this.config.logger[level](message);
    }
  }
}
