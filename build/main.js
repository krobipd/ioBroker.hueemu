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
var import_adapter_core = require("@iobroker/adapter-core");
var import_node_path = require("node:path");
var uuid = __toESM(require("uuid"));
var forge = __toESM(require("node-forge"));
var import_node_crypto = require("node:crypto");
var import_server = require("./server");
var import_discovery = require("./discovery");
var import_hue_api = require("./hue-api");
var import_device_management = require("./device-management");
var import_coerce = require("./lib/coerce");
var import_i18n = require("./lib/i18n");
var import_migrations = require("./lib/migrations");
var import_config = require("./types/config");
var import_utils = require("./types/utils");
class HueEmu extends utils.Adapter {
  /** Pairing window duration in milliseconds (50 seconds) */
  static PAIRING_TIMEOUT_MS = 5e4;
  // v1.10.0 (H1): bound the awaited SSDP start. Originally a hard requirement —
  // node-ssdp could hang forever on a swallowed 1900 bind error; the hand-built
  // server (v1.13.0) settles deterministically, so this is now defense in depth
  // (fakeroku keeps the same belt-and-braces bound). 5s is far above a local bind.
  static SSDP_START_TIMEOUT_MS = 5e3;
  // The ssdp:alive pulse cadence — node-ssdp's adInterval option, now an
  // adapter-managed interval (fleet timer rule).
  static SSDP_AD_INTERVAL_MS = 1e4;
  pairingTimeoutId = void 0;
  ssdpAnnounceInterval = void 0;
  _pairingEnabled = false;
  _disableAuth = false;
  // v1.12.0: set when buildConfig / getOrCreateTlsMaterial persist generated
  // identity or TLS material into native — that write triggers an instance
  // restart (jsonConfig semantics), so onReady short-circuits instead of binding
  // servers the imminent restart would tear down.
  nativePersistPending = false;
  hueServer = null;
  ssdpServer = null;
  apiHandler = null;
  // v1.11.0: official ioBroker device-manager backend for the devices tab
  // (manual add/edit/delete + a "search lights" assistant). Instantiated in the
  // constructor as required by dm-utils; it owns no state, it reads/writes
  // native.devices via this adapter.
  deviceManagement;
  /**
   * Factories for the server/discovery/API collaborators — default to the
   * real constructors. Test seams (fleet pattern, see
   * `reference_orchestration_test_harness`): the orchestration unit tests
   * replace these with fakes to exercise onReady/onStateChange/onUnload
   * without binding real ports or speaking SSDP.
   *
   * @param options Constructor options of the respective collaborator
   */
  makeHueServer = (options) => new import_server.HueServer(options);
  makeSsdpServer = (options) => new import_discovery.HueSsdpServer(options);
  makeApiHandler = (options) => new import_hue_api.ApiHandler(options);
  /**
   * Create a new Hue Emulator adapter instance
   *
   * @param options - Adapter options
   */
  constructor(options = {}) {
    super({
      ...options,
      name: "hueemu"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
    this.deviceManagement = new import_device_management.HueEmuDeviceManagement(this);
  }
  /** Whether pairing mode is active */
  get pairingEnabled() {
    return this._pairingEnabled;
  }
  /** Set pairing mode and manage timeout */
  set pairingEnabled(value) {
    this._pairingEnabled = value;
    if (!value) {
      this.clearPairingTimeout();
    }
    this.ackState("startPairing", value);
  }
  /** Clear the pairing-window timeout if one is pending */
  clearPairingTimeout() {
    if (this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = void 0;
    }
  }
  /**
   * Fire-and-forget ack write that never rejects — a broker-down during the
   * setState is logged, not fatal. Covers the `void this.setState(...)` paths
   * locally, so no global process-level unhandled-rejection net is needed.
   *
   * @param id - State id (relative to namespace)
   * @param val - Value to write with ack:true
   */
  ackState(id, val) {
    void this.setState(id, { ack: true, val }).catch((e) => this.log.error(`setState ${id} failed: ${(0, import_utils.errText)(e)}`));
  }
  /** Whether authentication is disabled */
  get disableAuth() {
    return this._disableAuth;
  }
  /** Set authentication disabled flag and persist */
  set disableAuth(value) {
    this._disableAuth = value;
    this.ackState("disableAuth", value);
    this.log.info(value ? "Authentication disabled (all requests allowed)" : "Authentication enabled");
  }
  /**
   * Called when databases are connected and adapter received configuration
   */
  async onReady() {
    var _a, _b, _c;
    try {
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      this.log.debug(`onReady: starting (devices in config: ${(_b = (_a = this.config.devices) == null ? void 0 : _a.length) != null ? _b : 0})`);
      const migrated = await this.migrateLegacyDevices();
      if (migrated) {
        return;
      }
      await this.migrateInstanceObjectNames();
      const emulatorConfig = await this.buildConfig();
      if (this.nativePersistPending) {
        this.log.info("Persisted generated bridge identity/TLS \u2014 restarting with the stored configuration.");
        return;
      }
      const logger = this.createLogger();
      const devices = this.config.devices || [];
      this.ssdpServer = this.makeSsdpServer({
        identity: emulatorConfig.identity,
        host: emulatorConfig.advertiseHost,
        port: emulatorConfig.port,
        logger,
        // A socket death after a good start kills discovery for good — stop the
        // announce pulse instead of multicasting into a closed socket every 10s.
        onFatalError: () => this.stopSsdpAnnounce()
      });
      this.apiHandler = this.makeApiHandler({
        adapter: this,
        configServiceConfig: {
          identity: emulatorConfig.identity,
          advertiseHost: emulatorConfig.advertiseHost
        },
        devices,
        logger
      });
      await this.apiHandler.initialize();
      this.hueServer = this.makeHueServer({
        config: emulatorConfig,
        handler: this.apiHandler,
        logger
      });
      await this.initializeAdapterStates();
      await this.hueServer.start();
      try {
        await this.startSsdpWithTimeout();
        (_c = this.ssdpServer) == null ? void 0 : _c.announce();
        this.ssdpAnnounceInterval = this.setInterval(() => {
          var _a2;
          return (_a2 = this.ssdpServer) == null ? void 0 : _a2.announce();
        }, HueEmu.SSDP_AD_INTERVAL_MS);
      } catch (err) {
        this.log.warn(
          `SSDP discovery disabled \u2014 port 1900 unavailable (${(0, import_utils.errText)(err)}). HTTP API still reachable; configure clients with the bridge IP manually.`
        );
      }
      await this.cleanupObsoleteStates();
      this.subscribeStates("*");
      this.log.debug("Subscribed to own states (pattern: *)");
      this.log.info(
        `Hue Emulator running, reachable at ${emulatorConfig.advertiseHost}:${emulatorConfig.port}${emulatorConfig.https ? " (HTTPS)" : ""}, ${devices.length} device(s)`
      );
    } catch (error) {
      this.log.error(`Failed to start Hue Emulator: ${(0, import_utils.errText)(error)}`);
    }
  }
  /**
   * Build emulator configuration from adapter config
   */
  async buildConfig() {
    var _a, _b, _c, _d, _e;
    const host = ((_a = this.config.host) == null ? void 0 : _a.trim()) || "0.0.0.0";
    const port = this.toPort(this.config.port);
    const legacyAdvertise = typeof this.config.advertiseHost === "string" ? this.config.advertiseHost.trim() : "";
    const advertiseHost = host !== "0.0.0.0" ? host : legacyAdvertise && legacyAdvertise !== "0.0.0.0" ? legacyAdvertise : (0, import_config.detectPrimaryIPv4)();
    const httpsPort = (0, import_coerce.parsePort)(this.config.httpsPort);
    (0, import_config.validateNetworkConfig)(advertiseHost, port, httpsPort);
    const udn = ((_b = this.config.udn) == null ? void 0 : _b.trim()) || uuid.v4();
    const mac = ((_c = this.config.mac) == null ? void 0 : _c.trim()) || (0, import_config.macFromUdn)(udn);
    if (!((_d = this.config.udn) == null ? void 0 : _d.trim()) || !((_e = this.config.mac) == null ? void 0 : _e.trim())) {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { udn, mac }
      });
      this.nativePersistPending = true;
    }
    const identity = {
      udn,
      mac,
      bridgeId: (0, import_config.generateBridgeId)(mac),
      modelId: import_config.BRIDGE_MODEL_ID,
      serialNumber: (0, import_config.generateSerialNumber)(mac)
    };
    let https;
    if (httpsPort) {
      const { cert, key } = await this.getOrCreateTlsMaterial();
      https = { port: httpsPort, cert, key };
    }
    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`
    );
    this.log.debug(
      `Network: bind=${host}:${port}, advertise=${advertiseHost}, SSDP=:${import_discovery.SSDP_PORT}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`
    );
    this.log.debug(`UDN: ${identity.udn}`);
    return {
      host,
      port,
      advertiseHost,
      https,
      identity,
      trustProxy: this.config.trustProxy === true
    };
  }
  /**
   * v1.4.3 (M1+M3+M5): persist the self-signed TLS cert/key in `native`
   * so they survive restarts. Real Hue clients (Echo, Harmony, Wall Display)
   * don't pin the cert — but regenerating each restart wasted ~1-2 s of
   * sync RSA-keygen on the event loop and gave clients fresh cert warnings
   * every time. Now: read from native; only generate (and persist) if
   * missing/malformed. Serial number is randomized so reissues aren't
   * identical (RFC 5280).
   */
  async getOrCreateTlsMaterial() {
    const persistedCert = typeof this.config.tlsCert === "string" ? this.config.tlsCert.trim() : "";
    const persistedKey = typeof this.config.tlsKey === "string" ? this.config.tlsKey.trim() : "";
    if (persistedCert.startsWith("-----BEGIN CERTIFICATE-----") && (persistedKey.startsWith("-----BEGIN RSA PRIVATE KEY-----") || persistedKey.startsWith("-----BEGIN PRIVATE KEY-----"))) {
      try {
        const parsed = forge.pki.certificateFromPem(persistedCert);
        if (parsed.validity.notAfter > /* @__PURE__ */ new Date()) {
          this.log.debug(`Reusing persisted TLS certificate (notAfter=${parsed.validity.notAfter.toISOString()})`);
          return { cert: persistedCert, key: persistedKey };
        }
        this.log.warn(
          `Persisted TLS certificate expired (notAfter=${parsed.validity.notAfter.toISOString()}) \u2014 regenerating`
        );
      } catch (err) {
        this.log.warn(`Persisted TLS certificate invalid (${(0, import_utils.errText)(err)}) \u2014 regenerating`);
      }
    }
    const generated = this.generateCertificate();
    try {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { tlsCert: generated.certificate, tlsKey: generated.privateKey }
      });
      this.log.info("Generated and persisted self-signed TLS certificate (10-year validity)");
      this.nativePersistPending = true;
    } catch (err) {
      this.log.warn(`TLS cert generated but failed to persist: ${(0, import_utils.errText)(err)} \u2014 will regenerate next restart`);
    }
    return { cert: generated.certificate, key: generated.privateKey };
  }
  /**
   * Generate a self-signed certificate for HTTPS
   */
  generateCertificate() {
    this.log.debug("Generating self-signed certificate for HTTPS");
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    const serialBytes = (0, import_node_crypto.randomBytes)(16);
    serialBytes[0] &= 127;
    cert.serialNumber = serialBytes.toString("hex");
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
   * Initialize adapter state values. Object creation is handled by
   * io-package.json:instanceObjects (declared once with translation-objects),
   * so we only need to seed the initial values here.
   */
  async initializeAdapterStates() {
    this.pairingEnabled = false;
    const disableAuthState = await this.getStateAsync("disableAuth");
    this._disableAuth = (0, import_coerce.coerceBool)(disableAuthState == null ? void 0 : disableAuthState.val);
  }
  /**
   * Start the SSDP server bounded by a managed timeout. Historically a hard
   * requirement (H1): node-ssdp swallowed a socket bind error and never settled
   * its start() promise, hanging onReady forever. The hand-built server settles
   * deterministically on every bind outcome, so the bound is defense in depth
   * now (fakeroku keeps the same belt-and-braces). The this.setTimeout
   * (auto-cleared on unload) rejects the race so onReady degrades to "SSDP
   * disabled, HTTP stays up" (S2); after a timeout the server holds no socket,
   * so onUnload's stop() is a safe no-op.
   */
  /** Stop the ssdp:alive pulse — on unload and when the SSDP socket dies. */
  stopSsdpAnnounce() {
    if (this.ssdpAnnounceInterval !== void 0) {
      this.clearInterval(this.ssdpAnnounceInterval);
      this.ssdpAnnounceInterval = void 0;
    }
  }
  async startSsdpWithTimeout() {
    const ssdp = this.ssdpServer;
    if (!ssdp) {
      return;
    }
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new Error(
            `SSDP start timed out after ${HueEmu.SSDP_START_TIMEOUT_MS}ms \u2014 port 1900 is likely held by another process`
          )
        );
      }, HueEmu.SSDP_START_TIMEOUT_MS);
      void ssdp.start().then(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          this.clearTimeout(timer);
          resolve();
        },
        (err) => {
          if (settled) {
            return;
          }
          settled = true;
          this.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }
  /**
   * Migrate v1.3.x instanceObject names/descriptions from plain English strings
   * to translation objects. instanceObjects are NOT re-applied on adapter
   * upgrade, so this is the only path that backfills translations for users
   * who installed before v1.4.0. Idempotent (logic in {@link runInstanceObjectMigration}).
   */
  async migrateInstanceObjectNames() {
    await (0, import_migrations.runInstanceObjectMigration)({
      getObjectAsync: (id) => this.getObjectAsync(id),
      extendObjectAsync: (id, obj) => this.extendObjectAsync(id, obj),
      log: { debug: (msg) => this.log.debug(msg) }
    });
  }
  /**
   * Remove states/channels/objects that were removed in newer adapter versions
   */
  async cleanupObsoleteStates() {
    await (0, import_migrations.runObsoleteStateCleanup)({
      namespace: this.namespace,
      getObjectAsync: (id) => this.getObjectAsync(id),
      delObjectAsync: (id) => this.delObjectAsync(id),
      getObjectListAsync: (query) => this.getObjectListAsync(query),
      log: { debug: (msg) => this.log.debug(msg) }
    });
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
      endkey: `${this.namespace}.user.${import_migrations.ID_RANGE_END}`
    });
    if ((children == null ? void 0 : children.rows) && children.rows.length > 0) {
      await this.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: { name: (0, import_i18n.tName)("clientsFolder"), type: "meta.folder" },
        native: {}
      });
      await Promise.all(
        children.rows.map(async (row) => {
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
        })
      );
    }
    await this.delObjectAsync("user");
    this.log.info(`Migrated ${(_b = (_a = children == null ? void 0 : children.rows) == null ? void 0 : _a.length) != null ? _b : 0} paired client(s) from "user" to "clients"`);
  }
  /**
   * Create a logger adapter for the modules
   */
  createLogger() {
    return {
      debug: (msg) => this.log.debug(msg),
      info: (msg) => this.log.info(msg),
      warn: (msg) => this.log.warn(msg),
      error: (msg) => this.log.error(msg)
    };
  }
  /**
   * Called when adapter shuts down
   *
   * @param callback - Callback to invoke when shutdown is complete
   */
  onUnload(callback) {
    try {
      this.clearPairingTimeout();
      this.stopSsdpAnnounce();
      if (this.ssdpServer) {
        this.ssdpServer.stop();
      }
      if (this.hueServer) {
        this.hueServer.stop().catch((err) => this.log.error(`Server stop error: ${(0, import_utils.errText)(err)}`));
      }
    } catch (error) {
      this.log.error(`Error during shutdown: ${(0, import_utils.errText)(error)}`);
    } finally {
      callback();
    }
  }
  /**
   * Called if a subscribed state changes
   *
   * @param id - Full state ID that changed
   * @param state - New state value or null if deleted
   */
  onStateChange(id, state) {
    try {
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
        this.disableAuth = (0, import_coerce.coerceBool)(state.val);
      } else if (id.startsWith(this.namespace)) {
        this.ackState(id, state.val);
      }
    } catch (err) {
      this.log.error(`stateChange failed: ${(0, import_utils.errText)(err)}`);
    }
  }
  /**
   * Handle startPairing state change
   *
   * @param state - State containing the pairing toggle value
   */
  handleStartPairing(state) {
    var _a;
    this.clearPairingTimeout();
    const enabled = (0, import_coerce.coerceBool)(state.val);
    this.pairingEnabled = enabled;
    if (enabled) {
      (_a = this.apiHandler) == null ? void 0 : _a.resetAutoAddBudget();
      const seconds = HueEmu.PAIRING_TIMEOUT_MS / 1e3;
      this.log.info(`Pairing mode enabled \u2014 waiting for client to connect (${seconds} seconds)`);
      this.pairingTimeoutId = this.setTimeout(() => {
        this._pairingEnabled = false;
        this.ackState("startPairing", false);
        this.log.info(`Pairing mode automatically disabled after ${seconds} seconds timeout`);
      }, HueEmu.PAIRING_TIMEOUT_MS);
    } else {
      this.log.info(`Pairing mode disabled`);
    }
  }
  /**
   * Migrate legacy devices (created via createLight JSON) to admin-configured
   * DeviceConfig format. Thin wrapper over the pure {@link runLegacyDeviceMigration}
   * helper (extracted to `lib/migrations.ts` for direct unit-testing, like the
   * other two migrations).
   *
   * @returns true if migration was performed (adapter will restart with new config)
   */
  async migrateLegacyDevices() {
    return (0, import_migrations.runLegacyDeviceMigration)({
      namespace: this.namespace,
      configuredDevices: this.config.devices,
      getDevicesAsync: () => this.getDevicesAsync(),
      getStateAsync: (id) => this.getStateAsync(id),
      getStatesOfAsync: (device, channel) => this.getStatesOfAsync(device, channel),
      extendForeignObjectAsync: (id, obj) => this.extendForeignObjectAsync(id, obj),
      delObjectAsync: (id) => this.delObjectAsync(id),
      log: { info: (msg) => this.log.info(msg), warn: (msg) => this.log.warn(msg) }
    });
  }
  /**
   * Parse a required port number from admin config (string or number).
   * Throws when the value is missing or unparseable — caller must handle.
   *
   * @param port - Raw port value from config
   */
  toPort(port) {
    const parsed = (0, import_coerce.parsePort)(port);
    if (parsed === void 0) {
      throw new Error("Port not specified");
    }
    return parsed;
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
