"use strict";
/**
 * Configuration Service for Hue API
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
/**
 * Service for providing Hue bridge configuration
 */
class ConfigService {
    identity;
    discoveryHost;
    // Bridge configuration constants
    static SW_VERSION = "1941132080";
    static API_VERSION = "1.41.0";
    static DATASTORE_VERSION = "98";
    static MODEL_ID = "BSB002";
    static BRIDGE_NAME = "Philips hue";
    constructor(config) {
        this.identity = config.identity;
        this.discoveryHost = config.discoveryHost;
    }
    /**
     * Get public bridge configuration (no auth required)
     */
    getConfig() {
        return {
            name: ConfigService.BRIDGE_NAME,
            datastoreversion: ConfigService.DATASTORE_VERSION,
            swversion: ConfigService.SW_VERSION,
            apiversion: ConfigService.API_VERSION,
            mac: this.identity.mac,
            bridgeid: this.identity.bridgeId,
            factorynew: false,
            replacesbridgeid: null,
            modelid: ConfigService.MODEL_ID,
            starterkitid: "",
        };
    }
    /**
     * Get full bridge configuration (requires auth)
     */
    getFullConfig() {
        return {
            ...this.getConfig(),
            ipaddress: this.discoveryHost,
            netmask: "255.255.255.0",
            gateway: this.discoveryHost.replace(/\.\d+$/, ".1"),
            dhcp: true,
            portalservices: true,
            portalconnection: "connected",
            portalstate: {
                signedon: true,
                incoming: false,
                outgoing: true,
                communication: "disconnected",
            },
            linkbutton: false,
            touchlink: false,
            zigbeechannel: 20,
            UTC: new Date().toISOString().replace("T", " ").substring(0, 19),
            localtime: new Date().toISOString().replace("T", " ").substring(0, 19),
            timezone: "Europe/Berlin",
            whitelist: {},
        };
    }
    /**
     * Build full state response
     */
    buildFullState(lights) {
        return {
            lights,
            groups: {},
            config: this.getFullConfig(),
            schedules: {},
            scenes: {},
            rules: {},
            sensors: {},
            resourcelinks: {},
        };
    }
}
exports.ConfigService = ConfigService;
//# sourceMappingURL=config-service.js.map