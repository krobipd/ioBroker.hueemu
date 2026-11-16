/**
 * SSDP server for Hue bridge discovery — hand-built on node:dgram (fakeroku's
 * responder pattern), replacing node-ssdp (unmaintained since 2020, permanent
 * `ip`-advisory noise, swallowed bind errors). The datagrams are byte-identical
 * to what node-ssdp 4.0.1 produced here (wire-captured 2026-08-24); the pure
 * builders live in ssdp-messages.ts.
 *
 * Announcing (D17, krobi 2026-11-11 19:34; Werkbank text of 2026-11-15): a NOTIFY has no asker, so
 * without a chosen address it goes out once per announceable IPv4 address — from a small sender socket bound
 * to that network's address and pinned to its interface, carrying that address — and with a chosen
 * address from the receiving socket, pinned to it. The adapter picks no address (fakeroku's
 * per-interface sender as the pattern).
 *
 * Owns no timers: the adapter drives {@link HueSsdpServer.announce} on a
 * managed interval and bounds {@link HueSsdpServer.start} with a managed
 * timeout (defense in depth — start() itself settles on every bind outcome,
 * which node-ssdp did not: its swallowed bind error was the old H1 hang).
 */

import * as dgram from "node:dgram";
import type { BridgeIdentity, Logger } from "../types/config";
import { errText } from "../lib/err-text";
import { announceAddresses, localNets, ownAddressFor, ownNets } from "../lib/network-address";
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
 * The largest datagram the listener reads. An M-SEARCH is a few hundred bytes; the
 * limit keeps a crafted 60 KB datagram from costing parse time (audit 2026-09-25 Q1).
 */
const MAX_SEARCH_DATAGRAM_BYTES = 2048;

/**
 * Configuration for the SSDP discovery server
 */
export interface SsdpServerConfig {
  /** Bridge identity */
  identity: BridgeIdentity;
  /** HTTP port where description.xml is served */
  port: number;
  /**
   * The address chosen in the settings, or undefined for every address (fleet master
   * network-address.ts, `chosenAddress` after the `carriesAddress` fallback). A chosen address
   * is the only interface the group is joined on and the NOTIFYs leave from.
   */
  bindIp?: string;
  /**
   * The adapter's trust boundary (`isOwnPeer` of the fleet master): a search from a peer
   * outside the adapter's networks is not answered.
   */
  isClientAllowed: (address: string | undefined) => boolean;
  /** Logger */
  logger: Logger;
  /**
   * Called at most once if the socket dies AFTER a successful start — lets the
   * adapter stop its announce interval instead of pulsing into a dead socket.
   */
  onFatalError?: () => void;
}

/** A socket the NOTIFYs go out through, with the address they carry. */
interface Announcer {
  /** The socket — a per-network sender, or the receiving socket with a chosen address. */
  socket: dgram.Socket;
  /** This host's address in the socket's network — the LOCATION its NOTIFYs name. */
  address: string;
}

/**
 * SSDP Discovery Server for Hue Bridge emulation: answers M-SEARCH for the
 * bridge's targets and multicasts the periodic ssdp:alive pulse.
 */
export class HueSsdpServer {
  private socket: dgram.Socket | null = null;
  /** The per-network NOTIFY senders without a chosen address — one per announceable IPv4 address. */
  private senders: Announcer[] = [];
  private readonly config: SsdpServerConfig;
  private readonly bridgeId: string;
  private readonly targets: SsdpTarget[];
  private fatalReported = false;

  /**
   * Create a new SSDP discovery server
   *
   * @param config - SSDP server configuration
   */
  constructor(config: SsdpServerConfig) {
    this.config = config;
    this.bridgeId = config.identity.bridgeId;
    this.targets = buildUsnTable(config.identity.udn);
  }

  /**
   * Bind the SSDP port, join the multicast group on every IPv4 network of the
   * host (or on the chosen address alone), open the per-network NOTIFY senders
   * without a chosen address, and start answering searches. Rejects on a bind
   * error — deterministically, unlike node-ssdp.
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
        socket.bind(SSDP_PORT, () => {
          socket.removeListener("error", onBindError);
          this.joinMulticast(socket);
          this.chooseMulticastInterface(socket);
          try {
            socket.setMulticastTTL(MULTICAST_TTL);
          } catch (e) {
            this.config.logger.warn(`SSDP: could not set multicast TTL: ${errText(e)}`);
          }
          // Like node-ssdp: discovery must not keep an otherwise-done process alive.
          socket.unref();
          socket.on("error", (err: Error) => this.onSocketError(err));
          socket.on("message", (msg, rinfo) => this.onDatagram(msg, rinfo.address, rinfo.port));
          resolve();
        });
      });
      if (this.config.bindIp === undefined) {
        await this.openSenders();
      }

      const announced = this.announcers(socket).map(out => out.address);
      this.config.logger.debug(
        `SSDP server started on port ${SSDP_PORT}${announced.length === 0 ? "" : `, announcing on ${announced.join(", ")}`}`,
      );
    } catch (error) {
      this.socket = null;
      this.closeSenders();
      // A socket whose bind failed is still an open handle — release it.
      try {
        created?.close();
      } catch {
        // already closed
      }
      // No log line here: the caller reports the failure once, as a warning.
      throw error instanceof Error ? error : new Error(errText(error), { cause: error });
    }
  }

  /**
   * Open one NOTIFY sender per announceable IPv4 address (fleet master `announceAddresses` over `localNets`,
   * the only reader of the interfaces — the master leaves out what an announcement never names, the adapter
   * leaves out nothing itself, Werkbank standard 74d84aa54d89):
   * bound to that network's address and pinned to its interface, so every network hears an address it
   * can reach. A sender that cannot open only costs its network the proactive NOTIFY — a search from
   * there is still answered.
   */
  private async openSenders(): Promise<void> {
    const addresses = announceAddresses(undefined, "IPv4", localNets());
    const opened = await Promise.all(addresses.map(address => this.openSender(address)));
    this.senders = opened.filter((out): out is Announcer => out !== undefined);
  }

  /**
   * Open the NOTIFY sender of one network.
   *
   * @param address - This host's address in the network
   * @returns the sender, or undefined when it could not open
   */
  private openSender(address: string): Promise<Announcer | undefined> {
    return new Promise<Announcer | undefined>(resolve => {
      let socket: dgram.Socket;
      try {
        socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      } catch (e) {
        this.config.logger.warn(`SSDP sender on ${address} could not open: ${errText(e)}`);
        resolve(undefined);
        return;
      }
      const onBindError = (err: Error): void => {
        this.config.logger.warn(`SSDP sender on ${address} could not open: ${errText(err)}`);
        try {
          socket.close();
        } catch {
          // already closed
        }
        resolve(undefined);
      };
      socket.once("error", onBindError);
      socket.bind({ address, port: 0 }, () => {
        socket.removeListener("error", onBindError);
        try {
          socket.setMulticastInterface(address);
          socket.setMulticastTTL(MULTICAST_TTL);
        } catch (e) {
          this.config.logger.warn(`SSDP sender on ${address} could not pin its interface: ${errText(e)}`);
        }
        socket.unref();
        socket.on("error", (err: Error) => this.config.logger.debug(`SSDP sender on ${address}: ${errText(err)}`));
        resolve({ socket, address });
      });
    });
  }

  /** Close every per-network sender. */
  private closeSenders(): void {
    for (const sender of this.senders) {
      try {
        sender.socket.close();
      } catch {
        // already closed
      }
    }
    this.senders = [];
  }

  /**
   * The sockets the NOTIFYs go out through: with a chosen address the receiving socket (pinned to it),
   * otherwise one sender per own network.
   *
   * @param receiver - The bound receiving socket
   * @returns the sockets with the address their NOTIFYs carry
   */
  private announcers(receiver: dgram.Socket): Announcer[] {
    const chosen = this.config.bindIp;
    return chosen === undefined ? this.senders : [{ socket: receiver, address: chosen }];
  }

  /**
   * Join the multicast group on each IPv4 network of the host, or on the OS
   * default when none is known. A failure warns but does not throw, so one bad
   * interface cannot stop the responder (fakeroku pattern).
   *
   * @param socket - The bound SSDP socket
   */
  private joinMulticast(socket: dgram.Socket): void {
    // A chosen address keeps discovery in its network (krobi 2026-10-03, fleet
    // master network-address.ts) — the group is joined on that interface alone.
    if (this.config.bindIp !== undefined) {
      this.tryJoin(socket, this.config.bindIp);
      return;
    }
    // Every IPv4 network of the host a device sits in (fleet master network-address.ts, `ownNets`
    // — the only reader of the interfaces; loopback is none): a search can come from any of them.
    const addresses = [
      ...new Set(
        ownNets(undefined)
          .filter(net => net.family === "IPv4")
          .map(net => net.address),
      ),
    ];
    if (addresses.length === 0) {
      this.tryJoin(socket, undefined);
      return;
    }
    for (const address of addresses) {
      this.tryJoin(socket, address);
    }
  }

  /**
   * With a chosen address the receiving socket sends the NOTIFYs, from that
   * interface. With every address the per-network senders of {@link openSenders}
   * send them, each from its own interface; the receiving socket sends only the
   * bye-bye then, and only when no sender is open (default route).
   *
   * @param socket - The bound SSDP socket
   */
  private chooseMulticastInterface(socket: dgram.Socket): void {
    if (this.config.bindIp === undefined) {
      return;
    }
    try {
      socket.setMulticastInterface(this.config.bindIp);
    } catch (e) {
      this.config.logger.warn(`SSDP: could not send from ${this.config.bindIp}: ${errText(e)}`);
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
   * Guard in front of {@link onMessage}: nothing a datagram carries may take the
   * process down. v1.19.0 (audit 2026-09-25 H1): a source port of 0 — legal on the
   * wire (RFC 768) — made the synchronous `send` throw `ERR_SOCKET_BAD_PORT` inside
   * this listener, an uncaught exception that ended the adapter. A real M-SEARCH is a
   * few hundred bytes; anything far larger is dropped before it is even decoded.
   *
   * @param msg - The raw datagram
   * @param address - Sender address
   * @param port - Sender port
   */
  private onDatagram(msg: Buffer, address: string, port: number): void {
    if (port <= 0 || port > 65535 || msg.length > MAX_SEARCH_DATAGRAM_BYTES) {
      return;
    }
    try {
      this.onMessage(msg.toString("utf8"), address, port);
    } catch (e) {
      this.config.logger.debug(`SSDP: ignored a datagram from ${address}:${port} (${errText(e)})`);
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
    if (!this.config.isClientAllowed(address)) {
      return;
    }
    // D17 (fleet rule krobi 2026-11-11 19:34): the location names the address the searching
    // client reaches this host under — never an address the adapter picked.
    const host = ownAddressFor(address, this.config.bindIp);
    if (host === undefined) {
      return;
    }
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
      const response = Buffer.from(buildSearchResponse(answer, this.bridgeAt(host), dateUtc), "ascii");
      try {
        this.socket?.send(response, port, address, err => {
          if (err) {
            this.config.logger.warn(`SSDP response send failed: ${err.message}`);
          }
        });
      } catch (e) {
        // `send` validates address and port synchronously — a throw here must not
        // escape the socket's event handler.
        this.config.logger.debug(`SSDP response to ${address}:${port} not sent: ${errText(e)}`);
      }
    }
    // The diagnostically useful "device asked, we answered" pulse.
    this.config.logger.debug(`SSDP M-SEARCH response → ${address}`);
  }

  /**
   * The bridge as a client at this address sees it: its id and the description URL there.
   *
   * @param host - This host's address for the client
   */
  private bridgeAt(host: string): SsdpAdvertisedBridge {
    return { bridgeId: this.bridgeId, location: getDescriptionUrl(host, this.config.port) };
  }

  /**
   * Multicast one ssdp:alive NOTIFY per target through every announcer, each naming its own
   * address. The adapter calls this right after start and then on a managed interval
   * (node-ssdp's adInterval role).
   */
  public announce(): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    for (const out of this.announcers(socket)) {
      for (const target of this.targets) {
        const notify = Buffer.from(buildAliveNotify(target, this.bridgeAt(out.address)), "ascii");
        try {
          out.socket.send(notify, SSDP_PORT, SSDP_MULTICAST_ADDR, err => {
            if (err) {
              this.config.logger.debug(`SSDP NOTIFY send failed: ${err.message}`);
            }
          });
        } catch (e) {
          this.config.logger.debug(`SSDP NOTIFY on ${out.address} not sent: ${errText(e)}`);
        }
      }
    }
  }

  /**
   * A socket error after a good start — discovery is dead. Close the socket and
   * tell the adapter once so it can stop the announce interval.
   *
   * @param err - The socket error
   */
  private onSocketError(err: Error): void {
    this.config.logger.error(`SSDP socket error: ${errText(err)}`);
    const socket = this.socket;
    this.socket = null;
    this.closeSenders();
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
    // The bye-bye leaves through the same sockets as the NOTIFYs, so every network that heard the
    // bridge hears it go; it names no address, so without a network of its own the receiving
    // socket sends it on the default route as before.
    const senders = this.senders;
    this.senders = [];
    const outs = senders.length > 0 ? senders.map(out => out.socket) : [socket];

    // Resolves once every bye-bye datagram has left and the sockets are closed. The caller
    // (onUnload) awaits this before telling the controller it is done: report first and the
    // host tears the process down mid-send, so the clients never learn the bridge is gone
    // — exactly the case this whole goodbye exists for.
    return new Promise<void>(resolve => {
      let pending = outs.length * this.targets.length;
      const closeSockets = (): void => {
        for (const open of [...senders.map(out => out.socket), socket]) {
          try {
            open.close();
          } catch {
            // socket already closed
          }
        }
        resolve();
      };
      for (const out of outs) {
        for (const target of this.targets) {
          const notify = Buffer.from(buildByeNotify(target, this.bridgeId), "ascii");
          try {
            out.send(notify, SSDP_PORT, SSDP_MULTICAST_ADDR, () => {
              pending--;
              if (pending === 0) {
                closeSockets();
              }
            });
          } catch {
            pending--;
          }
        }
      }
      if (pending === 0) {
        // Every send failed synchronously — nothing will call back.
        closeSockets();
      }
    });
  }
}
