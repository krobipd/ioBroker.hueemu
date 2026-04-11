"use strict";
/**
 * SSDP Server wrapper for Hue Bridge Discovery
 * Uses node-ssdp for UPnP/SSDP communication
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HueSsdpServer = void 0;
const node_ssdp_1 = require("node-ssdp");
const description_xml_1 = require("./description-xml");
/**
 * SSDP Discovery Server for Hue Bridge emulation
 */
class HueSsdpServer {
    server = null;
    config;
    isRunning = false;
    constructor(config) {
        this.config = {
            ...config,
            ssdpPort: config.ssdpPort ?? 1900,
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
            await new Promise((resolve, reject) => {
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
            this.log("debug", `SSDP server started on port ${this.config.ssdpPort}, advertising at ${location}`);
        }
        catch (error) {
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
//# sourceMappingURL=ssdp-server.js.map