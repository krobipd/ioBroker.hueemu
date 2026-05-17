/**
 * SSDP Server wrapper for Hue Bridge Discovery
 * Uses node-ssdp for UPnP/SSDP communication
 */

import { Server as SsdpServer } from "node-ssdp";
import type { BridgeIdentity, Logger } from "../types/config";
import { errText } from "../types/utils";
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
  /** Logger */
  logger: Logger;
  /** ioBroker system language for user-facing log strings */
}

/**
 * SSDP Discovery Server for Hue Bridge emulation
 */
export class HueSsdpServer {
  private server: SsdpServer | null = null;
  private readonly config: Required<SsdpServerConfig>;
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
      this.config.logger.debug("SSDP server already running");
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

      this.server = new SsdpServer(serverOptions);

      // Add the Basic device type that Hue apps search for
      // Register both cases since some clients (e.g. Harmony Hub) use lowercase
      this.server.addUSN("urn:schemas-upnp-org:device:Basic:1");
      this.server.addUSN("urn:schemas-upnp-org:device:basic:1");
      this.server.addUSN("upnp:rootdevice");
      this.config.logger.debug("SSDP USNs registered: Basic:1, basic:1, upnp:rootdevice");

      // v1.4.3 (S1): typed cast instead of `as any`. node-ssdp's Server
      // extends EventEmitter but the upstream typings omit the `error`
      // event; cast to a narrow EventEmitter-shape so the rest of the
      // file stays strictly typed.
      //
      // v1.4.5 (A): widen the cast to cover `response` + `advertise-bye`
      // events so we can trace M-SEARCH responses (the diagnostically
      // useful "device asked, we answered" pulse) and the explicit
      // unadvertise on stop. `advertise-alive` deliberately NOT hooked —
      // 10s × 24h = 8640 identical lines/day with zero variation.
      const serverWithEvents = this.server as unknown as {
        on(event: "error" | "advertise-bye" | "response", listener: (...args: unknown[]) => void): void;
      };
      serverWithEvents.on("error", (err: unknown) => {
        this.config.logger.error(`SSDP error: ${errText(err)}`);
      });
      serverWithEvents.on("response", (_headers, _statusCode, rinfo) => {
        const peer = (rinfo as { address?: string } | undefined)?.address ?? "?";
        this.config.logger.debug(`SSDP M-SEARCH response → ${peer}`);
      });
      serverWithEvents.on("advertise-bye", () => {
        this.config.logger.debug("SSDP advertise-bye sent (server stopping)");
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
      this.config.logger.debug(`SSDP server started on port ${this.config.ssdpPort}, advertising at ${location}`);
    } catch (error) {
      this.config.logger.error(`Failed to start SSDP server: ${errText(error)}`);
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
      this.config.logger.debug("SSDP server stopped");
    }
  }

  /**
   * Check if server is running
   */
  public get running(): boolean {
    return this.isRunning;
  }
}
