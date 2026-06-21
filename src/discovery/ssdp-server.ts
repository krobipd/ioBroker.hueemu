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
}

/**
 * SSDP Discovery Server for Hue Bridge emulation
 */
export class HueSsdpServer {
  private server: SsdpServer | null = null;
  private readonly config: Required<SsdpServerConfig>;
  private isRunning = false;

  /**
   * Create a new SSDP discovery server
   *
   * @param config - SSDP server configuration
   */
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
        // allowWildcards stays OFF. Real Hue/UPnP clients search by an exact ST
        // or `ssdp:all`, never with `*`. With it on, node-ssdp builds a fresh
        // RegExp from the attacker-controlled M-SEARCH `ST` header on every
        // packet — a crafted ST causes catastrophic backtracking (unauth DoS).
        // Off = plain string equality. (`ttl` dropped: it set the M-SEARCH
        // max-age, not the multicast hop limit, so the node-ssdp default fits.)
        allowWildcards: false,
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

      // v1.4.5 (A): typed cast to a narrow EventEmitter-shape (node-ssdp's
      // upstream typings omit these events) so we can trace M-SEARCH responses
      // (the diagnostically useful "device asked, we answered" pulse) and the
      // explicit unadvertise on stop. `advertise-alive` deliberately NOT hooked
      // — 10s × 24h = 8640 identical lines/day. The `error` event is not hooked:
      // node-ssdp's Server never emits a server-level `error` (socket errors are
      // swallowed internally), so a listener would never fire; start-time
      // failures surface via the start() promise rejection (caught in main.ts).
      const serverWithEvents = this.server as unknown as {
        on(event: "advertise-bye" | "response", listener: (...args: unknown[]) => void): void;
      };
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
}
