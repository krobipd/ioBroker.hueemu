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
var ssdp_server_exports = {};
__export(ssdp_server_exports, {
  HueSsdpServer: () => HueSsdpServer,
  SSDP_PORT: () => SSDP_PORT
});
module.exports = __toCommonJS(ssdp_server_exports);
var dgram = __toESM(require("node:dgram"));
var os = __toESM(require("node:os"));
var import_utils = require("../types/utils");
var import_description_xml = require("./description-xml");
var import_ssdp_messages = require("./ssdp-messages");
const SSDP_PORT = 1900;
const MULTICAST_TTL = 4;
class HueSsdpServer {
  socket = null;
  config;
  ssdpPort;
  bridge;
  targets;
  fatalReported = false;
  /**
   * Create a new SSDP discovery server
   *
   * @param config - SSDP server configuration
   */
  constructor(config) {
    var _a;
    this.config = config;
    this.ssdpPort = (_a = config.ssdpPort) != null ? _a : SSDP_PORT;
    this.bridge = {
      bridgeId: config.identity.bridgeId,
      location: (0, import_description_xml.getDescriptionUrl)(config.host, config.port)
    };
    this.targets = (0, import_ssdp_messages.buildUsnTable)(config.identity.udn);
  }
  /**
   * Bind the SSDP port, join the multicast group on every routable IPv4
   * interface (node-ssdp's default), and start answering searches. Rejects on
   * a bind error — deterministically, unlike node-ssdp.
   */
  async start() {
    if (this.socket) {
      this.config.logger.debug("SSDP server already running");
      return;
    }
    try {
      const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.socket = socket;
      await new Promise((resolve, reject) => {
        const onBindError = (err) => reject(err);
        socket.once("error", onBindError);
        socket.bind(this.ssdpPort, () => {
          socket.removeListener("error", onBindError);
          this.joinMulticast(socket);
          try {
            socket.setMulticastTTL(MULTICAST_TTL);
          } catch (e) {
            this.config.logger.warn(`SSDP: could not set multicast TTL: ${(0, import_utils.errText)(e)}`);
          }
          socket.unref();
          socket.on("error", (err) => this.onSocketError(err));
          socket.on("message", (msg, rinfo) => this.onMessage(msg.toString("utf8"), rinfo.address, rinfo.port));
          resolve();
        });
      });
      this.config.logger.debug(`SSDP server started on port ${this.ssdpPort}, advertising at ${this.bridge.location}`);
    } catch (error) {
      this.socket = null;
      this.config.logger.error(`Failed to start SSDP server: ${(0, import_utils.errText)(error)}`);
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
  joinMulticast(socket) {
    const addresses = [];
    const interfaces = os.networkInterfaces();
    for (const infos of Object.values(interfaces)) {
      for (const info of infos != null ? infos : []) {
        if (!info.internal && info.family === "IPv4") {
          addresses.push(info.address);
        }
      }
    }
    if (addresses.length === 0) {
      this.tryJoin(socket, void 0);
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
  tryJoin(socket, iface) {
    try {
      socket.addMembership(import_ssdp_messages.SSDP_MULTICAST_ADDR, iface);
    } catch (e) {
      this.config.logger.warn(
        `SSDP multicast join failed on ${iface != null ? iface : "default interface"}: ${(0, import_utils.errText)(e)} \u2014 discovery may be incomplete`
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
  onMessage(text, address, port) {
    var _a;
    const st = (0, import_ssdp_messages.parseMSearchTarget)(text);
    if (st === void 0) {
      return;
    }
    const answers = (0, import_ssdp_messages.matchSearch)(st, this.targets);
    if (answers.length === 0) {
      return;
    }
    const dateUtc = (/* @__PURE__ */ new Date()).toUTCString();
    for (const answer of answers) {
      const response = Buffer.from((0, import_ssdp_messages.buildSearchResponse)(answer, this.bridge, dateUtc), "ascii");
      (_a = this.socket) == null ? void 0 : _a.send(response, port, address, (err) => {
        if (err) {
          this.config.logger.warn(`SSDP response send failed: ${err.message}`);
        }
      });
    }
    this.config.logger.debug(`SSDP M-SEARCH response \u2192 ${address}`);
  }
  /**
   * Multicast one ssdp:alive NOTIFY per target. The adapter calls this right
   * after start and then on a managed interval (node-ssdp's adInterval role).
   */
  announce() {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    for (const target of this.targets) {
      const notify = Buffer.from((0, import_ssdp_messages.buildAliveNotify)(target, this.bridge), "ascii");
      socket.send(notify, this.ssdpPort, import_ssdp_messages.SSDP_MULTICAST_ADDR, (err) => {
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
  onSocketError(err) {
    var _a, _b;
    this.config.logger.error(`SSDP socket error: ${err.message}`);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
      }
    }
    if (!this.fatalReported) {
      this.fatalReported = true;
      (_b = (_a = this.config).onFatalError) == null ? void 0 : _b.call(_a);
    }
  }
  /**
   * Stop the SSDP server: multicast the ssdp:byebye NOTIFYs, then close the
   * socket once the last send has called back (node-ssdp closed in the same
   * tick, so its byebye never reached the wire). Synchronous to call — safe
   * from onUnload; the unref'd socket cannot keep the process alive.
   */
  stop() {
    const socket = this.socket;
    if (!socket) {
      return Promise.resolve();
    }
    this.socket = null;
    return new Promise((resolve) => {
      let pending = this.targets.length;
      const closeSocket = () => {
        try {
          socket.close();
        } catch {
        }
        resolve();
      };
      for (const target of this.targets) {
        const notify = Buffer.from((0, import_ssdp_messages.buildByeNotify)(target, this.bridge.bridgeId), "ascii");
        try {
          socket.send(notify, this.ssdpPort, import_ssdp_messages.SSDP_MULTICAST_ADDR, () => {
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
        closeSocket();
      }
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueSsdpServer,
  SSDP_PORT
});
//# sourceMappingURL=ssdp-server.js.map
