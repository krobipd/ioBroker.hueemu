"use strict";
/**
 * ioBroker Hue Emulator Adapter
 * Emulates a Philips Hue Bridge for smart home integrations
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
exports.HueEmu = void 0;
const utils = require("@iobroker/adapter-core");
const uuid = require("uuid");
const forge = require("node-forge");
const hue_emu_definition_1 = require("./definition/hue-emu-definition");
const server_1 = require("./server");
const discovery_1 = require("./discovery");
const hue_api_1 = require("./hue-api");
const config_1 = require("./types/config");
/**
 * Hue Emulator Adapter
 */
class HueEmu extends utils.Adapter {
    constructor(options = {}) {
        super(Object.assign(Object.assign({}, options), { name: "hueemu" }));
        this.pairingTimeoutId = null;
        this._pairingEnabled = false;
        this._disableAuth = false;
        this.hueServer = null;
        this.ssdpServer = null;
        this.apiHandler = null;
        this.on("ready", this.onReady.bind(this));
        this.on("objectChange", this.onObjectChange.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.definition = new hue_emu_definition_1.HueEmuDefinition(this);
    }
    get pairingEnabled() {
        return this._pairingEnabled;
    }
    /**
     *
     */
    set pairingEnabled(value) {
        this._pairingEnabled = value;
        this.setState("startPairing", { ack: true, val: value });
    }
    /**
     *
     */
    get disableAuth() {
        return this._disableAuth;
    }
    /**
     *
     */
    set disableAuth(value) {
        this._disableAuth = value;
        this.setState("disableAuth", { ack: true, val: value });
    }
    /**
     * Called when databases are connected and adapter received configuration
     */
    onReady() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.silly("onReady called. Loading configuration");
            try {
                // Parse and validate configuration
                const emulatorConfig = yield this.buildConfig();
                // Create logger adapter
                const logger = this.createLogger();
                // Get device configurations from admin UI
                const devices = this.config.devices || [];
                this.log.info(`Loaded ${devices.length} device(s) from configuration`);
                // Initialize SSDP discovery server
                this.ssdpServer = new discovery_1.HueSsdpServer({
                    identity: emulatorConfig.identity,
                    host: emulatorConfig.discoveryHost || emulatorConfig.host,
                    port: emulatorConfig.discoveryPort || emulatorConfig.port,
                    ssdpPort: emulatorConfig.upnpPort,
                    logger,
                });
                // Create API handler with device configurations
                this.apiHandler = new hue_api_1.ApiHandler({
                    adapter: this,
                    configServiceConfig: {
                        identity: emulatorConfig.identity,
                        discoveryHost: emulatorConfig.discoveryHost || emulatorConfig.host,
                    },
                    devices,
                    logger,
                });
                // Initialize API handler (sets up state subscriptions for device bindings)
                yield this.apiHandler.initialize();
                // Initialize HTTP server
                this.hueServer = new server_1.HueServer({
                    config: emulatorConfig,
                    handler: this.apiHandler,
                    logger,
                });
                // Start servers
                yield this.ssdpServer.start();
                yield this.hueServer.start();
                // Initialize adapter states
                yield this.initializeAdapterStates();
                // Subscribe to state changes (own states)
                this.subscribeStates("*");
                // Log device info
                if (devices.length > 0) {
                    this.log.info("Configured devices:");
                    devices.forEach((device, index) => {
                        const mappedStates = [];
                        if (device.onState) {
                            mappedStates.push("on");
                        }
                        if (device.briState) {
                            mappedStates.push("bri");
                        }
                        if (device.ctState) {
                            mappedStates.push("ct");
                        }
                        if (device.hueState) {
                            mappedStates.push("hue");
                        }
                        if (device.satState) {
                            mappedStates.push("sat");
                        }
                        if (device.xyState) {
                            mappedStates.push("xy");
                        }
                        this.log.info(`  ${index + 1}. ${device.name} (${device.lightType}) - mapped: ${mappedStates.join(", ") || "none"}`);
                    });
                }
                this.log.info("Hue Emulator started successfully");
            }
            catch (error) {
                this.log.error(`Failed to start Hue Emulator: ${error}`);
            }
        });
    }
    /**
     * Build emulator configuration from adapter config
     */
    buildConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            // Parse configuration values
            const host = ((_a = this.config.host) === null || _a === void 0 ? void 0 : _a.trim()) || "";
            const port = this.toPort(this.config.port);
            const discoveryHost = ((_b = this.config.discoveryHost) === null || _b === void 0 ? void 0 : _b.trim()) || host;
            const discoveryPort = this.toPort(this.config.discoveryPort) || port;
            const httpsPort = this.toUndefinedPort(this.config.httpsPort);
            const udn = ((_c = this.config.udn) === null || _c === void 0 ? void 0 : _c.trim()) || uuid.v4();
            const mac = ((_d = this.config.mac) === null || _d === void 0 ? void 0 : _d.trim()) || "";
            const upnpPort = this.toDefaultPort(this.config.upnpPort, 1900);
            // Build bridge identity
            const identity = {
                udn,
                mac,
                bridgeId: (0, config_1.generateBridgeId)(mac),
                modelId: "BSB002",
                serialNumber: (0, config_1.generateSerialNumber)(mac),
            };
            // Build TLS config if HTTPS is enabled
            let https;
            if (httpsPort) {
                const cert = yield this.generateCertificate();
                https = {
                    port: httpsPort,
                    cert: cert.certificate,
                    key: cert.privateKey,
                };
            }
            return {
                host,
                port,
                discoveryHost,
                discoveryPort,
                https,
                upnpPort,
                identity,
            };
        });
    }
    /**
     * Generate a self-signed certificate for HTTPS
     */
    generateCertificate() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log.info("Generating self-signed certificate for HTTPS");
            const keys = forge.pki.rsa.generateKeyPair(2048);
            const cert = forge.pki.createCertificate();
            cert.publicKey = keys.publicKey;
            cert.serialNumber = "01";
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
            const attrs = [
                { name: "commonName", value: "Philips Hue" },
                { name: "countryName", value: "NL" },
                { name: "organizationName", value: "Philips Hue" },
            ];
            cert.setSubject(attrs);
            cert.setIssuer(attrs);
            cert.sign(keys.privateKey, forge.md.sha256.create());
            return {
                certificate: forge.pki.certificateToPem(cert),
                privateKey: forge.pki.privateKeyToPem(keys.privateKey),
            };
        });
    }
    /**
     * Initialize adapter states
     */
    initializeAdapterStates() {
        return __awaiter(this, void 0, void 0, function* () {
            // Create createLight state (for legacy manual light creation)
            yield this.setObjectNotExistsAsync("createLight", {
                type: "state",
                common: {
                    name: "createLight",
                    type: "string",
                    read: true,
                    write: true,
                    role: "state",
                    desc: "JSON to create lights manually (legacy mode)",
                },
                native: {},
            });
            // Create startPairing state
            yield this.setObjectNotExistsAsync("startPairing", {
                type: "state",
                common: {
                    name: "startPairing",
                    type: "boolean",
                    role: "button",
                    write: true,
                    read: true,
                    desc: "Enable pairing mode for 50 seconds",
                },
                native: {},
            });
            this.pairingEnabled = false;
            // Create disableAuth state
            yield this.setObjectNotExistsAsync("disableAuth", {
                type: "state",
                common: {
                    name: "disableAuthentication",
                    type: "boolean",
                    role: "switch",
                    write: true,
                    read: true,
                    desc: "Disable authentication (allow all requests)",
                },
                native: {},
            });
            // Load disableAuth state
            const disableAuthState = yield this.getStateAsync("disableAuth");
            this._disableAuth = (disableAuthState === null || disableAuthState === void 0 ? void 0 : disableAuthState.val) || false;
            // Create info channel
            yield this.setObjectNotExistsAsync("info", {
                type: "channel",
                common: {
                    name: "Adapter Information",
                },
                native: {},
            });
            // Create info.configuredDevices state
            const deviceCount = (this.config.devices || []).length;
            yield this.setObjectNotExistsAsync("info.configuredDevices", {
                type: "state",
                common: {
                    name: "Configured Devices",
                    type: "number",
                    role: "value",
                    read: true,
                    write: false,
                    desc: "Number of devices configured in admin UI",
                },
                native: {},
            });
            yield this.setStateAsync("info.configuredDevices", {
                val: deviceCount,
                ack: true,
            });
        });
    }
    /**
     * Create a logger adapter for the modules
     */
    createLogger() {
        return {
            silly: (msg) => this.log.silly(msg),
            debug: (msg) => this.log.debug(msg),
            info: (msg) => this.log.info(msg),
            warn: (msg) => this.log.warn(msg),
            error: (msg) => this.log.error(msg),
        };
    }
    /**
     * Called when adapter shuts down
     */
    onUnload(callback) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Clear pairing timeout
                if (this.pairingTimeoutId) {
                    clearTimeout(this.pairingTimeoutId);
                    this.pairingTimeoutId = null;
                }
                // Stop SSDP server
                if (this.ssdpServer) {
                    this.ssdpServer.stop();
                }
                // Stop HTTP server
                if (this.hueServer) {
                    yield this.hueServer.stop();
                }
                this.log.info("Hue Emulator stopped");
                callback();
            }
            catch (error) {
                this.log.error(`Error during shutdown: ${error}`);
                callback();
            }
        });
    }
    /**
     * Called if a subscribed object changes
     */
    onObjectChange(id, obj) {
        if (obj) {
            this.log.debug(`Object ${id} changed: ${JSON.stringify(obj)}`);
        }
        else {
            this.log.debug(`Object ${id} deleted`);
        }
    }
    /**
     * Called if a subscribed state changes
     */
    onStateChange(id, state) {
        if (!state) {
            this.log.debug(`State ${id} deleted`);
            return;
        }
        this.log.debug(`State ${id} changed: ${state.val} (ack = ${state.ack})`);
        // Update API handler state cache for device binding
        if (this.apiHandler && state.ack) {
            this.apiHandler.onStateChange(id, state.val);
        }
        // Only handle non-acked state changes for our own states
        if (state.ack) {
            return;
        }
        if (id === `${this.namespace}.createLight`) {
            this.handleCreateLight(id, state);
        }
        else if (id === `${this.namespace}.startPairing`) {
            this.handleStartPairing(state);
        }
        else if (id === `${this.namespace}.disableAuth`) {
            this.disableAuth = state.val;
        }
        else if (id.startsWith(this.namespace)) {
            // Acknowledge other own state changes
            this.setState(id, { ack: true, val: state.val });
        }
    }
    /**
     * Handle sendTo messages from admin UI
     */
    onMessage(obj) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!obj || !obj.command) {
                return;
            }
            // Ignore device-manager messages
            if (obj.command.startsWith("dm:")) {
                return;
            }
            this.log.debug(`Received message: ${obj.command}`);
            // No custom commands needed - configuration is done via jsonConfig
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, { error: "Unknown command" }, obj.callback);
            }
        });
    }
    /**
     * Handle startPairing state change
     */
    handleStartPairing(state) {
        if (this.pairingTimeoutId) {
            clearTimeout(this.pairingTimeoutId);
        }
        this.pairingEnabled = state.val;
        // Auto-disable pairing after 50 seconds
        if (state.val) {
            this.pairingTimeoutId = setTimeout(() => {
                this._pairingEnabled = false;
                this.setState("startPairing", { ack: true, val: false });
                this.log.info("Pairing mode automatically disabled after timeout");
            }, 50000);
        }
    }
    /**
     * Handle createLight state change (legacy mode)
     */
    handleCreateLight(id, state) {
        try {
            const lights = typeof state.val === "object"
                ? state.val
                : JSON.parse(state.val);
            this.log.info(`Creating lights (legacy mode): ${JSON.stringify(lights)}`);
            Object.keys(lights).forEach((lightId) => {
                try {
                    this.createLightDevice(lightId, lights);
                    this.createLightState(lightId, lights);
                    this.createLightName(lightId, lights);
                    this.createLightData(lightId, lights);
                    this.setState(id, { ack: true, val: state.val });
                }
                catch (error) {
                    this.log.warn(`Could not create light ${lightId}: ${error}`);
                }
            });
        }
        catch (error) {
            this.log.warn(`Could not parse lights: ${error}`);
        }
    }
    /**
     * Create light device object
     */
    createLightDevice(lightId, lights) {
        this.setObjectNotExists(lightId, {
            type: "device",
            common: {
                name: lights[lightId].name,
            },
            native: {},
        });
    }
    /**
     * Create light state channel and states
     */
    createLightState(lightId, lights) {
        this.setObjectNotExists(`${lightId}.state`, {
            type: "channel",
            common: {
                name: "state",
            },
            native: {},
        }, (err) => {
            if (!err) {
                this.definition.addFunction(lightId, "state", undefined);
            }
        });
        Object.keys(lights[lightId].state).forEach((stateKey) => {
            this.addState(`${lightId}.state.${stateKey}`, stateKey, lights[lightId].state[stateKey]);
        });
    }
    /**
     * Create light name state
     */
    createLightName(lightId, lights) {
        this.setObjectNotExists(`${lightId}.name`, {
            type: "state",
            common: {
                name: "name",
                type: "string",
                role: "text",
                read: true,
                write: true,
            },
            native: {},
        });
        this.setState(`${lightId}.name`, { ack: true, val: lights[lightId].name });
    }
    /**
     * Create light data state
     */
    createLightData(lightId, lights) {
        const data = {};
        Object.keys(lights[lightId]).forEach((key) => {
            if (key !== "state" && key !== "name") {
                data[key] = lights[lightId][key];
            }
        });
        this.setObjectNotExists(`${lightId}.data`, {
            type: "state",
            common: {
                name: "data",
                type: "object",
                role: "state",
                read: true,
                write: true,
            },
            native: {},
        });
        this.setState(`${lightId}.data`, { ack: true, val: JSON.stringify(data) });
    }
    /**
     * Add a state with type detection
     */
    addState(id, name, value) {
        const valueType = typeof value;
        let commonType = "mixed";
        if (valueType === "number" ||
            valueType === "string" ||
            valueType === "boolean" ||
            valueType === "object") {
            commonType = valueType;
        }
        this.setObjectNotExists(id, {
            type: "state",
            common: {
                name,
                type: commonType,
                role: hue_emu_definition_1.HueEmuDefinition.determineRole("state", name),
                read: true,
                write: true,
            },
            native: {},
        });
        this.setState(id, { ack: true, val: value });
    }
    /**
     * Parse port number
     */
    toPort(port) {
        if (port) {
            return typeof port === "number"
                ? port
                : parseInt(port.toString().trim(), 10);
        }
        throw new Error("Port not specified");
    }
    /**
     * Parse port with default value
     */
    toDefaultPort(port, defaultPort) {
        const parsed = this.toUndefinedPort(port);
        return parsed !== null && parsed !== void 0 ? parsed : defaultPort;
    }
    /**
     * Parse optional port
     */
    toUndefinedPort(port) {
        if (port) {
            return typeof port === "number" ? port : parseInt(port.toString(), 10);
        }
        return undefined;
    }
}
exports.HueEmu = HueEmu;
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new HueEmu(options);
}
else {
    // Start the instance directly
    (() => new HueEmu())();
}
