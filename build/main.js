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
var main_exports = {};
__export(main_exports, {
  HueEmu: () => HueEmu
});
module.exports = __toCommonJS(main_exports);
var utils = __toESM(require("@iobroker/adapter-core"));
var uuid = __toESM(require("uuid"));
var forge = __toESM(require("node-forge"));
var import_hue_emu_definition = require("./definition/hue-emu-definition");
var import_server = require("./server");
var import_discovery = require("./discovery");
var import_hue_api = require("./hue-api");
var import_config = require("./types/config");
class HueEmu extends utils.Adapter {
  pairingTimeoutId = void 0;
  _pairingEnabled = false;
  _disableAuth = false;
  definition;
  hueServer = null;
  ssdpServer = null;
  apiHandler = null;
  constructor(options = {}) {
    super({
      ...options,
      name: "hueemu"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.definition = new import_hue_emu_definition.HueEmuDefinition(this);
  }
  get pairingEnabled() {
    return this._pairingEnabled;
  }
  /**
   *
   */
  set pairingEnabled(value) {
    this._pairingEnabled = value;
    if (!value && this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = void 0;
    }
    void this.setState("startPairing", { ack: true, val: value });
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
    void this.setState("disableAuth", { ack: true, val: value });
    this.log.info(
      `Authentication ${value ? "disabled (all requests allowed)" : "enabled"}`
    );
  }
  /**
   * Called when databases are connected and adapter received configuration
   */
  async onReady() {
    try {
      const emulatorConfig = await this.buildConfig();
      const logger = this.createLogger();
      const devices = this.config.devices || [];
      this.ssdpServer = new import_discovery.HueSsdpServer({
        identity: emulatorConfig.identity,
        host: emulatorConfig.discoveryHost || emulatorConfig.host,
        port: emulatorConfig.discoveryPort || emulatorConfig.port,
        ssdpPort: emulatorConfig.upnpPort,
        logger
      });
      this.apiHandler = new import_hue_api.ApiHandler({
        adapter: this,
        configServiceConfig: {
          identity: emulatorConfig.identity,
          discoveryHost: emulatorConfig.discoveryHost || emulatorConfig.host
        },
        devices,
        logger
      });
      await this.apiHandler.initialize();
      this.hueServer = new import_server.HueServer({
        config: emulatorConfig,
        handler: this.apiHandler,
        logger
      });
      await this.ssdpServer.start();
      await this.hueServer.start();
      await this.initializeAdapterStates();
      await this.cleanupObsoleteStates();
      this.subscribeStates("*");
      this.log.debug(`${devices.length} device(s) loaded from configuration`);
      this.log.info("Hue Emulator started successfully");
    } catch (error) {
      this.log.error(`Failed to start Hue Emulator: ${error}`);
    }
  }
  /**
   * Build emulator configuration from adapter config
   */
  async buildConfig() {
    var _a, _b, _c, _d, _e, _f;
    const host = ((_a = this.config.host) == null ? void 0 : _a.trim()) || "";
    const port = this.toPort(this.config.port);
    const discoveryHost = ((_b = this.config.discoveryHost) == null ? void 0 : _b.trim()) || host;
    const discoveryPort = this.toPort(this.config.discoveryPort) || port;
    const httpsPort = this.toUndefinedPort(this.config.httpsPort);
    const udn = ((_c = this.config.udn) == null ? void 0 : _c.trim()) || uuid.v4();
    const mac = ((_d = this.config.mac) == null ? void 0 : _d.trim()) || this.macFromUdn(udn);
    if (!((_e = this.config.udn) == null ? void 0 : _e.trim()) || !((_f = this.config.mac) == null ? void 0 : _f.trim())) {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { udn, mac }
      });
    }
    const upnpPort = 1900;
    const identity = {
      udn,
      mac,
      bridgeId: (0, import_config.generateBridgeId)(mac),
      modelId: "BSB002",
      serialNumber: (0, import_config.generateSerialNumber)(mac)
    };
    let https;
    if (httpsPort) {
      const cert = await this.generateCertificate();
      https = {
        port: httpsPort,
        cert: cert.certificate,
        key: cert.privateKey
      };
    }
    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`
    );
    this.log.debug(
      `Network: HTTP=${host}:${port}, SSDP=:${upnpPort}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`
    );
    this.log.debug(`UDN: ${identity.udn}`);
    return {
      host,
      port,
      discoveryHost,
      discoveryPort,
      https,
      upnpPort,
      identity
    };
  }
  /**
   * Generate a self-signed certificate for HTTPS
   */
  async generateCertificate() {
    this.log.info("Generating self-signed certificate for HTTPS");
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = /* @__PURE__ */ new Date();
    cert.validity.notAfter = /* @__PURE__ */ new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 10
    );
    const attrs = [
      { name: "commonName", value: "Philips Hue" },
      { name: "countryName", value: "NL" },
      { name: "organizationName", value: "Philips Hue" }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    return {
      certificate: forge.pki.certificateToPem(cert),
      privateKey: forge.pki.privateKeyToPem(keys.privateKey)
    };
  }
  /**
   * Initialize adapter states
   */
  async initializeAdapterStates() {
    await this.setObjectNotExistsAsync("createLight", {
      type: "state",
      common: {
        name: "createLight",
        type: "string",
        read: true,
        write: true,
        role: "state",
        desc: "JSON to create lights manually (legacy mode)"
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("startPairing", {
      type: "state",
      common: {
        name: "startPairing",
        type: "boolean",
        role: "button",
        write: true,
        read: true,
        desc: "Enable pairing mode for 50 seconds"
      },
      native: {}
    });
    this.pairingEnabled = false;
    await this.setObjectNotExistsAsync("disableAuth", {
      type: "state",
      common: {
        name: "disableAuthentication",
        type: "boolean",
        role: "switch",
        write: true,
        read: true,
        desc: "Disable authentication (allow all requests)"
      },
      native: {}
    });
    const disableAuthState = await this.getStateAsync("disableAuth");
    this._disableAuth = (disableAuthState == null ? void 0 : disableAuthState.val) || false;
  }
  /**
   * Remove states/channels/objects that were removed in newer adapter versions
   */
  async cleanupObsoleteStates() {
    const obsoleteStates = [
      "info.configuredDevices"
      // removed in 1.0.15
    ];
    for (const stateId of obsoleteStates) {
      const obj = await this.getObjectAsync(stateId);
      if (obj) {
        await this.delObjectAsync(stateId);
        this.log.debug(`Removed obsolete state: ${stateId}`);
      }
    }
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
      error: (msg) => this.log.error(msg)
    };
  }
  /**
   * Called when adapter shuts down
   */
  onUnload(callback) {
    try {
      if (this.pairingTimeoutId) {
        this.clearTimeout(this.pairingTimeoutId);
        this.pairingTimeoutId = void 0;
      }
      if (this.ssdpServer) {
        this.ssdpServer.stop();
      }
      if (this.hueServer) {
        this.hueServer.stop().catch(
          (err) => this.log.error(`Server stop error: ${err.message}`)
        );
      }
      void this.setState("info.connection", { val: false, ack: true });
      callback();
    } catch (error) {
      this.log.error(`Error during shutdown: ${error}`);
      callback();
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
    if (this.apiHandler && state.ack) {
      this.apiHandler.onStateChange(id, state.val);
    }
    if (state.ack) {
      return;
    }
    if (id === `${this.namespace}.createLight`) {
      this.handleCreateLight(id, state);
    } else if (id === `${this.namespace}.startPairing`) {
      this.handleStartPairing(state);
    } else if (id === `${this.namespace}.disableAuth`) {
      this.disableAuth = state.val;
    } else if (id.startsWith(this.namespace)) {
      void this.setState(id, { ack: true, val: state.val });
    }
  }
  /**
   * Handle startPairing state change
   */
  handleStartPairing(state) {
    if (this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = void 0;
    }
    this.pairingEnabled = state.val;
    if (state.val) {
      this.log.info(
        "Pairing mode enabled \u2014 waiting for client to connect (50 seconds)"
      );
      this.pairingTimeoutId = this.setTimeout(() => {
        this._pairingEnabled = false;
        void this.setState("startPairing", { ack: true, val: false });
        this.log.info(
          "Pairing mode automatically disabled after 50 seconds timeout"
        );
      }, 5e4);
    } else {
      this.log.info("Pairing mode disabled");
    }
  }
  /**
   * Sanitize a name for use as an ioBroker object ID segment
   * @param name Raw name to sanitize
   */
  sanitizeId(name) {
    return (name || "").replace(this.FORBIDDEN_CHARS, "_").replace(/\./g, "_");
  }
  /**
   * Handle createLight state change (legacy mode)
   */
  handleCreateLight(id, state) {
    try {
      const lights = typeof state.val === "object" ? state.val : JSON.parse(state.val);
      this.log.debug(
        `Creating lights (legacy mode): ${JSON.stringify(lights)}`
      );
      Object.keys(lights).forEach((rawLightId) => {
        const lightId = this.sanitizeId(rawLightId);
        try {
          this.createLightDevice(lightId, lights[rawLightId]);
          this.createLightState(lightId, lights[rawLightId]);
          this.createLightName(lightId, lights[rawLightId]);
          this.createLightData(lightId, lights[rawLightId]);
          void this.setState(id, { ack: true, val: state.val });
        } catch (error) {
          this.log.warn(`Could not create light ${lightId}: ${error}`);
        }
      });
    } catch (error) {
      this.log.warn(`Could not parse lights: ${error}`);
    }
  }
  /**
   * Create light device object
   * @param lightId Sanitized light ID
   * @param light Light configuration object
   */
  createLightDevice(lightId, light) {
    void this.setObjectNotExists(lightId, {
      type: "device",
      common: {
        name: light.name
      },
      native: {}
    });
  }
  /**
   * Create light state channel and states
   * @param lightId Sanitized light ID
   * @param light Light configuration object
   */
  createLightState(lightId, light) {
    void this.setObjectNotExists(
      `${lightId}.state`,
      {
        type: "channel",
        common: {
          name: "state"
        },
        native: {}
      },
      (err) => {
        if (!err) {
          this.definition.addFunction(
            lightId,
            "state",
            void 0
          );
        }
      }
    );
    Object.keys(light.state).forEach((rawKey) => {
      const stateKey = this.sanitizeId(rawKey);
      this.addState(
        `${lightId}.state.${stateKey}`,
        stateKey,
        light.state[rawKey]
      );
    });
  }
  /**
   * Create light name state
   * @param lightId Sanitized light ID
   * @param light Light configuration object
   */
  createLightName(lightId, light) {
    void this.setObjectNotExists(`${lightId}.name`, {
      type: "state",
      common: {
        name: "name",
        type: "string",
        role: "text",
        read: true,
        write: true
      },
      native: {}
    });
    void this.setState(`${lightId}.name`, {
      ack: true,
      val: light.name
    });
  }
  /**
   * Create light data state
   * @param lightId Sanitized light ID
   * @param light Light configuration object
   */
  createLightData(lightId, light) {
    const data = {};
    Object.keys(light).forEach((key) => {
      if (key !== "state" && key !== "name") {
        data[key] = light[key];
      }
    });
    void this.setObjectNotExists(`${lightId}.data`, {
      type: "state",
      common: {
        name: "data",
        type: "object",
        role: "state",
        read: true,
        write: true
      },
      native: {}
    });
    void this.setState(`${lightId}.data`, {
      ack: true,
      val: JSON.stringify(data)
    });
  }
  /**
   * Add a state with type detection
   */
  addState(id, name, value) {
    const valueType = typeof value;
    let commonType = "mixed";
    if (valueType === "number" || valueType === "string" || valueType === "boolean" || valueType === "object") {
      commonType = valueType;
    }
    void this.setObjectNotExists(id, {
      type: "state",
      common: {
        name,
        type: commonType,
        role: import_hue_emu_definition.HueEmuDefinition.determineRole("state", name),
        read: true,
        write: true
      },
      native: {}
    });
    void this.setState(id, { ack: true, val: value });
  }
  /**
   * Parse port number
   */
  toPort(port) {
    if (port) {
      return typeof port === "number" ? port : parseInt(port.toString().trim(), 10);
    }
    throw new Error("Port not specified");
  }
  /**
   * Parse optional port
   */
  toUndefinedPort(port) {
    if (port) {
      return typeof port === "number" ? port : parseInt(port.toString(), 10);
    }
    return void 0;
  }
  /**
   * Derive a stable MAC address from the UDN (used when no MAC is configured)
   */
  macFromUdn(udn) {
    const hex = udn.replace(/-/g, "").slice(0, 12).padEnd(12, "0");
    return hex.match(/.{2}/g).join(":");
  }
}
if (require.main !== module) {
  module.exports = (options) => new HueEmu(options);
} else {
  (() => new HueEmu())();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueEmu
});
//# sourceMappingURL=main.js.map
