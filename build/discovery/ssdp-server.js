"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var ssdp_server_exports = {};
__export(ssdp_server_exports, {
  HueSsdpServer: () => HueSsdpServer
});
module.exports = __toCommonJS(ssdp_server_exports);
var import_node_ssdp = require("node-ssdp");
var import_description_xml = require("./description-xml");
class HueSsdpServer {
  server = null;
  config;
  isRunning = false;
  constructor(config) {
    var _a;
    this.config = {
      ...config,
      ssdpPort: (_a = config.ssdpPort) != null ? _a : 1900
    };
  }
  /**
   * Start the SSDP server and begin advertising
   */
  async start() {
    if (this.isRunning) {
      this.log("debug", "SSDP server already running");
      return;
    }
    try {
      const location = (0, import_description_xml.getDescriptionUrl)(this.config.host, this.config.port);
      const serverOptions = {
        location,
        sourcePort: this.config.ssdpPort,
        adInterval: 1e4,
        // Advertise every 10 seconds
        ttl: 4,
        allowWildcards: true,
        suppressRootDeviceAdvertisements: false,
        headers: {
          "hue-bridgeid": this.config.identity.bridgeId,
          SERVER: "Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0"
        },
        udn: `uuid:${this.config.identity.udn}`
      };
      this.server = new import_node_ssdp.Server(serverOptions);
      this.server.addUSN("urn:schemas-upnp-org:device:Basic:1");
      this.server.addUSN("urn:schemas-upnp-org:device:basic:1");
      this.server.addUSN("upnp:rootdevice");
      this.server.on("error", (err) => {
        this.log("error", `SSDP error: ${err.message}`);
      });
      await new Promise((resolve, reject) => {
        if (!this.server) {
          reject(new Error("Server not initialized"));
          return;
        }
        void this.server.start((err) => {
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
        `SSDP server started on port ${this.config.ssdpPort}, advertising at ${location}`
      );
    } catch (error) {
      this.log("error", `Failed to start SSDP server: ${error}`);
      throw error;
    }
  }
  /**
   * Stop the SSDP server
   */
  stop() {
    if (this.server && this.isRunning) {
      this.server.stop();
      this.isRunning = false;
      this.log("debug", "SSDP server stopped");
    }
  }
  /**
   * Send an SSDP notify message
   */
  notify() {
    if (this.server && this.isRunning) {
      this.log("debug", "Sending SSDP notify");
    }
  }
  /**
   * Check if server is running
   */
  get running() {
    return this.isRunning;
  }
  /**
   * Log a message
   */
  log(level, message) {
    if (this.config.logger) {
      this.config.logger[level](message);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueSsdpServer
});
//# sourceMappingURL=ssdp-server.js.map
