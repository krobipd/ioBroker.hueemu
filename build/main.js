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
var import_server = require("./server");
var import_discovery = require("./discovery");
var import_hue_api = require("./hue-api");
var import_config = require("./types/config");
var import_utils = require("./types/utils");
class HueEmu extends utils.Adapter {
  /** Pairing window duration in milliseconds (50 seconds) */
  static PAIRING_TIMEOUT_MS = 5e4;
  pairingTimeoutId = void 0;
  _pairingEnabled = false;
  _disableAuth = false;
  hueServer = null;
  ssdpServer = null;
  apiHandler = null;
  unhandledRejectionHandler = null;
  uncaughtExceptionHandler = null;
  constructor(options = {}) {
    super({
      ...options,
      name: "hueemu"
    });
    this.on("ready", () => {
      this.onReady().catch(
        (err) => this.log.error(`onReady failed: ${err instanceof Error ? err.message : String(err)}`)
      );
    });
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.unhandledRejectionHandler = (reason) => {
      this.log.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    };
    this.uncaughtExceptionHandler = (err) => {
      this.log.error(`Uncaught exception: ${err.message}`);
    };
    process.on("unhandledRejection", this.unhandledRejectionHandler);
    process.on("uncaughtException", this.uncaughtExceptionHandler);
  }
  get pairingEnabled() {
    return this._pairingEnabled;
  }
  set pairingEnabled(value) {
    this._pairingEnabled = value;
    if (!value && this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = void 0;
    }
    void this.setState("startPairing", { ack: true, val: value });
  }
  get disableAuth() {
    return this._disableAuth;
  }
  set disableAuth(value) {
    this._disableAuth = value;
    void this.setState("disableAuth", { ack: true, val: value });
    this.log.info(`Authentication ${value ? "disabled (all requests allowed)" : "enabled"}`);
  }
  /**
   * Called when databases are connected and adapter received configuration
   */
  async onReady() {
    try {
      const migrated = await this.migrateLegacyDevices();
      if (migrated) {
        return;
      }
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
      this.log.info(
        `Hue Emulator running on ${emulatorConfig.host}:${emulatorConfig.port}${emulatorConfig.https ? `, HTTPS :${emulatorConfig.https.port}` : ""}, ${devices.length} device(s)`
      );
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
      modelId: import_config.BRIDGE_MODEL_ID,
      serialNumber: (0, import_config.generateSerialNumber)(mac)
    };
    let https;
    if (httpsPort) {
      const cert = this.generateCertificate();
      https = {
        port: httpsPort,
        cert: cert.certificate,
        key: cert.privateKey
      };
    }
    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`
    );
    this.log.debug(`Network: HTTP=${host}:${port}, SSDP=:${upnpPort}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`);
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
  generateCertificate() {
    this.log.debug("Generating self-signed certificate for HTTPS");
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = /* @__PURE__ */ new Date();
    cert.validity.notAfter = /* @__PURE__ */ new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
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
    await this.setObjectNotExistsAsync("startPairing", {
      type: "state",
      common: {
        name: "startPairing",
        type: "boolean",
        role: "button",
        write: true,
        read: true,
        desc: `Enable pairing mode for ${HueEmu.PAIRING_TIMEOUT_MS / 1e3} seconds`
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
      "info.configuredDevices",
      // removed in 1.0.15
      "info.connection",
      // removed in 1.1.3 (adapter is a server, no outbound connection)
      "info",
      // empty folder after info.* states removed
      "createLight"
      // removed in 1.1.0 (legacy mode replaced by admin config + migration)
    ];
    for (const stateId of obsoleteStates) {
      const obj = await this.getObjectAsync(stateId);
      if (obj) {
        await this.delObjectAsync(stateId);
        this.log.debug(`Removed obsolete state: ${stateId}`);
        const parentId = stateId.includes(".") ? stateId.substring(0, stateId.lastIndexOf(".")) : null;
        if (parentId) {
          const children = await this.getObjectListAsync({
            startkey: `${this.namespace}.${parentId}.`,
            endkey: `${this.namespace}.${parentId}.\u9999`
          });
          if ((children == null ? void 0 : children.rows.length) === 0) {
            await this.delObjectAsync(parentId);
            this.log.debug(`Removed empty parent: ${parentId}`);
          }
        }
      }
    }
    await this.migrateUserToClients();
  }
  /**
   * Migrate legacy "user" folder to "clients" folder.
   * Copies paired client states, then removes the old "user" folder.
   */
  async migrateUserToClients() {
    var _a, _b;
    const userFolder = await this.getObjectAsync("user");
    if (!userFolder) {
      return;
    }
    const children = await this.getObjectListAsync({
      startkey: `${this.namespace}.user.`,
      endkey: `${this.namespace}.user.\u9999`
    });
    if ((children == null ? void 0 : children.rows) && children.rows.length > 0) {
      await this.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: { name: "Paired Clients", type: "meta.folder" },
        native: {}
      });
      for (const row of children.rows) {
        const oldId = row.id.replace(`${this.namespace}.`, "");
        const username = oldId.replace("user.", "");
        const newId = `clients.${(0, import_utils.sanitizeId)(username)}`;
        const state = await this.getStateAsync(oldId);
        const obj = row.value;
        await this.setObjectNotExistsAsync(newId, {
          type: "state",
          common: obj.common,
          native: obj.native || {}
        });
        if ((state == null ? void 0 : state.val) !== void 0 && (state == null ? void 0 : state.val) !== null) {
          await this.setStateAsync(newId, { val: state.val, ack: true });
        }
        await this.delObjectAsync(oldId);
        this.log.debug(`Migrated client ${username}: user \u2192 clients`);
      }
    }
    await this.delObjectAsync("user");
    this.log.info(`Migrated ${(_b = (_a = children == null ? void 0 : children.rows) == null ? void 0 : _a.length) != null ? _b : 0} paired client(s) from "user" to "clients"`);
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
        this.hueServer.stop().catch((err) => this.log.error(`Server stop error: ${err.message}`));
      }
      if (this.unhandledRejectionHandler) {
        process.off("unhandledRejection", this.unhandledRejectionHandler);
        this.unhandledRejectionHandler = null;
      }
      if (this.uncaughtExceptionHandler) {
        process.off("uncaughtException", this.uncaughtExceptionHandler);
        this.uncaughtExceptionHandler = null;
      }
    } catch (error) {
      this.log.error(`Error during shutdown: ${error}`);
    } finally {
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
    if (id === `${this.namespace}.startPairing`) {
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
      const seconds = HueEmu.PAIRING_TIMEOUT_MS / 1e3;
      this.log.info(`Pairing mode enabled \u2014 waiting for client to connect (${seconds} seconds)`);
      this.pairingTimeoutId = this.setTimeout(() => {
        this._pairingEnabled = false;
        void this.setState("startPairing", { ack: true, val: false });
        this.log.info(`Pairing mode automatically disabled after ${seconds} seconds timeout`);
      }, HueEmu.PAIRING_TIMEOUT_MS);
    } else {
      this.log.info("Pairing mode disabled");
    }
  }
  /**
   * Migrate legacy devices (created via createLight JSON) to admin-configured DeviceConfig format.
   * Legacy devices are ioBroker device objects in the adapter namespace with state/name/data children.
   * After migration, DeviceBindingService uses the existing state objects as foreign states.
   * @returns true if migration was performed (adapter will restart with new config)
   */
  async migrateLegacyDevices() {
    var _a;
    if (this.config.devices && this.config.devices.length > 0) {
      return false;
    }
    const devices = await this.getDevicesAsync();
    if (devices.length === 0) {
      return false;
    }
    this.log.info(`Found ${devices.length} legacy device(s) \u2014 migrating to new configuration`);
    const migratedDevices = [];
    for (const device of devices) {
      const deviceId = device._id.substring(this.namespace.length + 1);
      try {
        const nameState = await this.getStateAsync(`${deviceId}.name`);
        const name = (nameState == null ? void 0 : nameState.val) || ((_a = device.common) == null ? void 0 : _a.name) || deviceId;
        const stateObjects = await this.getStatesOfAsync(deviceId, "state");
        const stateKeys = new Set((stateObjects || []).map((s) => s._id.substring(s._id.lastIndexOf(".") + 1)));
        let lightType;
        if (stateKeys.has("hue") || stateKeys.has("sat") || stateKeys.has("xy")) {
          lightType = "color";
        } else if (stateKeys.has("ct")) {
          lightType = "ct";
        } else if (stateKeys.has("bri")) {
          lightType = "dimmable";
        } else {
          lightType = "onoff";
        }
        const config = { name, lightType };
        if (stateKeys.has("on")) {
          config.onState = `${this.namespace}.${deviceId}.state.on`;
        }
        if (stateKeys.has("bri")) {
          config.briState = `${this.namespace}.${deviceId}.state.bri`;
        }
        if (stateKeys.has("ct")) {
          config.ctState = `${this.namespace}.${deviceId}.state.ct`;
        }
        if (stateKeys.has("hue")) {
          config.hueState = `${this.namespace}.${deviceId}.state.hue`;
        }
        if (stateKeys.has("sat")) {
          config.satState = `${this.namespace}.${deviceId}.state.sat`;
        }
        if (stateKeys.has("xy")) {
          config.xyState = `${this.namespace}.${deviceId}.state.xy`;
        }
        migratedDevices.push(config);
        this.log.info(`Migrated legacy device "${name}" as ${lightType}`);
        await this.delObjectAsync(`${deviceId}.name`).catch(() => {
        });
        await this.delObjectAsync(`${deviceId}.data`).catch(() => {
        });
        await this.delObjectAsync(`${deviceId}.state`).catch(() => {
        });
        await this.delObjectAsync(deviceId).catch(() => {
        });
      } catch (error) {
        this.log.warn(`Could not migrate legacy device ${deviceId}: ${error}`);
      }
    }
    if (migratedDevices.length === 0) {
      return false;
    }
    await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
      native: { devices: migratedDevices }
    });
    this.log.info(`Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`);
    return true;
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
