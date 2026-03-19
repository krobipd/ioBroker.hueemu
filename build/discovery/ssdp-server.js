"use strict";
/**
 * SSDP Server wrapper for Hue Bridge Discovery
 * Uses node-ssdp for UPnP/SSDP communication
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HueSsdpServer = void 0;
const node_ssdp_1 = require("node-ssdp");
const description_xml_1 = require("./description-xml");
/**
 * SSDP Discovery Server for Hue Bridge emulation
 */
class HueSsdpServer {
    constructor(config) {
        var _a;
        this.server = null;
        this.isRunning = false;
        this.config = Object.assign(Object.assign({}, config), { ssdpPort: (_a = config.ssdpPort) !== null && _a !== void 0 ? _a : 1900 });
    }
    /**
     * Start the SSDP server and begin advertising
     */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.isRunning) {
                this.log("debug", "SSDP server already running");
                return;
            }
            try {
                const location = (0, description_xml_1.getDescriptionUrl)(this.config.host, this.config.port);
                const serverOptions = {
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
                this.server = new node_ssdp_1.Server(serverOptions);
                // Add the Basic device type that Hue apps search for
                // Register both cases since some clients (e.g. Harmony Hub) use lowercase
                this.server.addUSN("urn:schemas-upnp-org:device:Basic:1");
                this.server.addUSN("urn:schemas-upnp-org:device:basic:1");
                this.server.addUSN("upnp:rootdevice");
                // Handle errors - use type assertion as node-ssdp types may not include all events
                this.server.on("error", (err) => {
                    this.log("error", `SSDP error: ${err.message}`);
                });
                // Start the server
                yield new Promise((resolve, reject) => {
                    if (!this.server) {
                        reject(new Error("Server not initialized"));
                        return;
                    }
                    void this.server.start((err) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve();
                        }
                    });
                });
                this.isRunning = true;
                this.log("info", `SSDP server started on port ${this.config.ssdpPort}, advertising at ${location}`);
            }
            catch (error) {
                this.log("error", `Failed to start SSDP server: ${error}`);
                throw error;
            }
        });
    }
    /**
     * Stop the SSDP server
     */
    stop() {
        if (this.server && this.isRunning) {
            this.server.stop();
            this.isRunning = false;
            this.log("info", "SSDP server stopped");
        }
    }
    /**
     * Send an SSDP notify message
     */
    notify() {
        if (this.server && this.isRunning) {
            // Trigger an immediate advertisement
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
exports.HueSsdpServer = HueSsdpServer;
