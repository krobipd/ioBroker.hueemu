/**
 * SSDP server for Hue bridge discovery — hand-built on node:dgram (fakeroku's
 * responder pattern), replacing node-ssdp (unmaintained since 2020, permanent
 * `ip`-advisory noise, swallowed bind errors). The datagrams are byte-identical
 * to what node-ssdp 4.0.1 produced here (wire-captured 2026-08-24); the pure
 * builders live in ssdp-messages.ts.
 *
 * Owns no timers: the adapter drives {@link HueSsdpServer.announce} on a
 * managed interval and bounds {@link HueSsdpServer.start} with a managed
 * timeout (defense in depth — start() itself settles on every bind outcome,
 * which node-ssdp did not: its swallowed bind error was the old H1 hang).
 */

import * as dgram from "node:dgram";
import * as os from "node:os";
import type { BridgeIdentity, Logger } from "../types/config";
import { errText } from "../types/utils";
import { getDescriptionUrl } from "./description-xml";
import {
  SSDP_MULTICAST_ADDR,
  buildAliveNotify,
  buildByeNotify,
  buildSearchResponse,
  buildUsnTable,
  matchSearch,
  parseMSearchTarget,
  type SsdpAdvertisedBridge,
  type SsdpTarget,
} from "./ssdp-messages";

/** SSDP UPnP port — fixed at 1900 by the UPnP standard (design decision #2). */
export const SSDP_PORT = 1900;

/** Multicast hop limit node-ssdp used (its ssdpTtl default). */
const MULTICAST_TTL = 4;

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
  /**
   * Called at most once if the socket dies AFTER a successful start — lets the
   * adapter stop its announce interval instead of pulsing into a dead socket.
   */
  onFatalError?: () => void;
}

/**
 * SSDP Discovery Server for Hue Bridge emulation: answers M-SEARCH for the
 * bridge's targets and multicasts the periodic ssdp:alive pulse.
 */
export class HueSsdpServer {
  private socket: dgram.Socket | null = null;
  private readonly config: SsdpServerConfig;
  private readonly ssdpPort: number;
  private readonly bridge: SsdpAdvertisedBridge;
  private readonly targets: SsdpTarget[];
  private fatalReported = false;

  /**
   * Create a new SSDP discovery server
   *
   * @param config - SSDP server configuration
   */
  constructor(config: SsdpServerConfig) {
    this.config = config;
    this.ssdpPort = config.ssdpPort ?? SSDP_PORT;
    this.bridge = {
      bridgeId: config.identity.bridgeId,
      location: getDescriptionUrl(config.host, config.port),
    };
    this.targets = buildUsnTable(config.identity.udn);
  }

  /**
   * Bind the SSDP port, join the multicast group on every routable IPv4
   * interface (node-ssdp's default), and start answering searches. Rejects on
   * a bind error — deterministically, unlike node-ssdp.
   */
  public async start(): Promise<void> {
    if (this.socket) {
      this.config.logger.debug("SSDP server already running");
      return;
    }

    let created: dgram.Socket | null = null;
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      created = socket;
      this.socket = socket;

      await new Promise<void>((resolve, reject) => {
        const onBindError = (err: Error): void => reject(err);
        socket.once("error", onBindError);
        socket.bind(this.ssdpPort, () => {
          socket.removeListener("error", onBindError);
          this.joinMulticast(socket);
          try {
            socket.setMulticastTTL(MULTICAST_TTL);
          } catch (e) {
            this.config.logger.warn(`SSDP: could not set multicast TTL: ${errText(e)}`);
          }
          // Like node-ssdp: discovery must not keep an otherwise-done process alive.
          socket.unref();
          socket.on("error", (err: Error) => this.onSocketError(err));
          socket.on("message", (msg, rinfo) => this.onMessage(msg.toString("utf8"), rinfo.address, rinfo.port));
          resolve();
        });
      });

      this.config.logger.debug(`SSDP server started on port ${this.ssdpPort}, advertising at ${this.bridge.location}`);
    } catch (error) {
      this.socket = null;
      // A socket whose bind failed is still an open handle — release it.
      try {
        created?.close();
      } catch {
        // already closed
      }
      this.config.logger.error(`Failed to start SSDP server: ${errText(error)}`);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Join the multicast group on each routable IPv4 interface, or on the OS
   * default when none is known. A failure warns but does not throw, so one bad
   * interface cannot stop the responder (fakeroku pattern).
   *
   * @param socket - The bound SSDP socket
   */
  private joinMulticast(socket: dgram.Socket): void {
    const addresses: string[] = [];
    const interfaces = os.networkInterfaces();
    for (const infos of Object.values(interfaces)) {
      for (const info of infos ?? []) {
        if (!info.internal && info.family === "IPv4") {
          addresses.push(info.address);
        }
      }
    }
    if (addresses.length === 0) {
      this.tryJoin(socket, undefined);
      return;
    }
    for (const address of addresses) {
      this.tryJoin(socket, address);
    }
  }

  /**
   * Join the group on one interface, warning instead of throwing on failure.
   *
   * @param socket - The bound SSDP socket
   * @param iface - The interface IP to join on, or undefined for the OS default
   */
  private tryJoin(socket: dgram.Socket, iface: string | undefined): void {
    try {
      socket.addMembership(SSDP_MULTICAST_ADDR, iface);
    } catch (e) {
      this.config.logger.warn(
        `SSDP multicast join failed on ${iface ?? "default interface"}: ${errText(e)} — discovery may be incomplete`,
      );
    }
  }

  /**
   * Answer an incoming datagram when it is an M-SEARCH for one of our targets.
   *
   * @param text - The datagram text
   * @param address - Sender address (responses go back here, unicast)
   * @param port - Sender port
   */
  private onMessage(text: string, address: string, port: number): void {
    const st = parseMSearchTarget(text);
    if (st === undefined) {
      return;
    }
    const answers = matchSearch(st, this.targets);
    if (answers.length === 0) {
      return;
    }
    const dateUtc = new Date().toUTCString();
    for (const answer of answers) {
      const response = Buffer.from(buildSearchResponse(answer, this.bridge, dateUtc), "ascii");
      this.socket?.send(response, port, address, err => {
        if (err) {
          this.config.logger.warn(`SSDP response send failed: ${err.message}`);
        }
      });
    }
    // The diagnostically useful "device asked, we answered" pulse.
    this.config.logger.debug(`SSDP M-SEARCH response → ${address}`);
  }

  /**
   * Multicast one ssdp:alive NOTIFY per target. The adapter calls this right
   * after start and then on a managed interval (node-ssdp's adInterval role).
   */
  public announce(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    for (const target of this.targets) {
      const notify = Buffer.from(buildAliveNotify(target, this.bridge), "ascii");
      socket.send(notify, this.ssdpPort, SSDP_MULTICAST_ADDR, err => {
        if (err) {
          this.config.logger.debug(`SSDP NOTIFY send failed: ${err.message}`);
        }
      });
    }
  }

  /**
   * A socket error after a good start — discovery is dead. Close the socket and
   * tell the adapter once so it can stop the announce interval.
   *
   * @param err - The socket error
   */
  private onSocketError(err: Error): void {
    this.config.logger.error(`SSDP socket error: ${err.message}`);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // socket already closed
      }
    }
    if (!this.fatalReported) {
      this.fatalReported = true;
      this.config.onFatalError?.();
    }
  }

  /**
   * Stop the SSDP server: multicast the ssdp:byebye NOTIFYs, then close the
   * socket once the last send has called back (node-ssdp closed in the same
   * tick, so its byebye never reached the wire). Synchronous to call — safe
   * from onUnload; the unref'd socket cannot keep the process alive.
   */
  public stop(): Promise<void> {
    const socket = this.socket;
    // Shortcut, deliberately without its own test: every step below tolerates a
    // missing socket on its own (try/catch around send and close), so removing
    // this guard changes nothing observable (equivalent mutant, 2026-09-02 test
    // audit). It stays because it says what a stop without a running service is.
    if (!socket) {
      return Promise.resolve();
    }
    this.socket = null;

    // Resolves once every bye-bye datagram has left and the socket is closed. The caller
    // (onUnload) awaits this before telling the controller it is done: report first and the
    // host tears the process down mid-send, so the clients never learn the bridge is gone
    // — exactly the case this whole goodbye exists for.
    return new Promise<void>(resolve => {
      let pending = this.targets.length;
      const closeSocket = (): void => {
        try {
          socket.close();
        } catch {
          // socket already closed
        }
        resolve();
      };
      for (const target of this.targets) {
        const notify = Buffer.from(buildByeNotify(target, this.bridge.bridgeId), "ascii");
        try {
          socket.send(notify, this.ssdpPort, SSDP_MULTICAST_ADDR, () => {
            pending--;
            if (pending === 0) {
              closeSocket();
            }
          });
        } catch {
          pending--;
        }
      }
      if (pending === 0) {
        // Every send failed synchronously — nothing will call back.
        closeSocket();
      }
    });
  }
}
