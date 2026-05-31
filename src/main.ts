/**
 * ioBroker Hue Emulator Adapter
 * Emulates a Philips Hue Bridge for smart home integrations
 */

import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import * as uuid from "uuid";
import * as forge from "node-forge";
import { randomBytes } from "node:crypto";

import { HueServer } from "./server";
import { HueSsdpServer } from "./discovery";
import { ApiHandler, type ApiHandlerAdapter, type DeviceConfig } from "./hue-api";
import { coerceBool, parsePort } from "./lib/coerce";
import { tName } from "./lib/i18n";
import {
  ID_RANGE_END,
  detectLegacyLightType,
  runInstanceObjectMigration,
  runObsoleteStateCleanup,
} from "./lib/migrations";
import type { HueEmulatorConfig, BridgeIdentity, TlsConfig, Logger } from "./types/config";
import { BRIDGE_MODEL_ID, generateBridgeId, generateSerialNumber, macFromUdn } from "./types/config";
import { errText, sanitizeId } from "./types/utils";

// Augment the adapter.config object with the actual types
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ioBroker {
    interface AdapterConfig {
      host: string;
      port: number;
      discoveryHost: string;
      discoveryPort: number;
      httpsPort: number | undefined;
      tlsCert?: string;
      tlsKey?: string;
      trustProxy?: boolean;
      udn: string;
      mac: string;
      devices: DeviceConfig[];
    }
  }
}

/**
 * Hue Emulator Adapter
 */
export class HueEmu extends utils.Adapter {
  /** Pairing window duration in milliseconds (50 seconds) */
  private static readonly PAIRING_TIMEOUT_MS = 50_000;

  private pairingTimeoutId: ioBroker.Timeout | undefined = undefined;
  private _pairingEnabled = false;
  private _disableAuth = false;

  private hueServer: HueServer | null = null;
  private ssdpServer: HueSsdpServer | null = null;
  private apiHandler: ApiHandler | null = null;

  /**
   * Create a new Hue Emulator adapter instance
   *
   * @param options - Adapter options
   */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "hueemu",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /** Whether pairing mode is active */
  get pairingEnabled(): boolean {
    return this._pairingEnabled;
  }

  /** Set pairing mode and manage timeout */
  set pairingEnabled(value: boolean) {
    this._pairingEnabled = value;
    if (!value) {
      this.clearPairingTimeout();
    }
    this.ackState("startPairing", value);
  }

  /** Clear the pairing-window timeout if one is pending */
  private clearPairingTimeout(): void {
    if (this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = undefined;
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
  private ackState(id: string, val: ioBroker.StateValue): void {
    void this.setState(id, { ack: true, val }).catch(e => this.log.error(`setState ${id} failed: ${errText(e)}`));
  }

  /** Whether authentication is disabled */
  get disableAuth(): boolean {
    return this._disableAuth;
  }

  /** Set authentication disabled flag and persist */
  set disableAuth(value: boolean) {
    this._disableAuth = value;
    this.ackState("disableAuth", value);
    this.log.info(value ? "Authentication disabled (all requests allowed)" : "Authentication enabled");
  }

  /**
   * Called when databases are connected and adapter received configuration
   */
  private async onReady(): Promise<void> {
    try {
      await I18n.init(join(this.adapterDir, "admin"), this);
      this.log.debug(`onReady: starting (devices in config: ${this.config.devices?.length ?? 0})`);

      // Migrate legacy devices (created via createLight) to admin config format
      const migrated = await this.migrateLegacyDevices();
      if (migrated) {
        // Config was updated — adapter will restart automatically
        return;
      }

      // Migrate v1.3.x instanceObject names to translation objects
      await this.migrateInstanceObjectNames();

      // Parse and validate configuration
      const emulatorConfig = await this.buildConfig();

      // Create logger adapter
      const logger = this.createLogger();

      // Get device configurations from admin UI
      const devices: DeviceConfig[] = this.config.devices || [];

      // Initialize SSDP discovery server
      this.ssdpServer = new HueSsdpServer({
        identity: emulatorConfig.identity,
        host: emulatorConfig.discoveryHost || emulatorConfig.host,
        port: emulatorConfig.discoveryPort || emulatorConfig.port,
        ssdpPort: emulatorConfig.upnpPort,
        logger,
      });

      // Double cast `unknown → ApiHandlerAdapter` because the Adapter base
      // class's `setStateAsync` returns `SetStatePromise` while our handler
      // interfaces specify `Promise<{ id: string }>`. They are semantically
      // equivalent for our usage; the explicit cast keeps the intent visible
      // without `any`.
      this.apiHandler = new ApiHandler({
        adapter: this as unknown as ApiHandlerAdapter,
        configServiceConfig: {
          identity: emulatorConfig.identity,
          discoveryHost: emulatorConfig.discoveryHost || emulatorConfig.host,
        },
        devices,
        logger,
      });

      // Initialize API handler (sets up state subscriptions for device bindings)
      await this.apiHandler.initialize();

      // Initialize HTTP server
      this.hueServer = new HueServer({
        config: emulatorConfig,
        handler: this.apiHandler,
        logger,
      });

      // v1.4.3 (S2): start HTTP first. SSDP port 1900 is shared by many
      // discovery adapters (shelly, tradfri, ...) — if it's already bound,
      // SSDP throws and we still want the Hue API reachable for clients
      // configured by manual IP. Log SSDP-failure but don't break the adapter.
      await this.hueServer.start();
      try {
        await this.ssdpServer.start();
      } catch (err) {
        this.log.warn(
          `SSDP discovery disabled — port 1900 unavailable (${errText(err)}). HTTP API still reachable; configure clients with the bridge IP manually.`,
        );
      }

      // Initialize adapter states
      await this.initializeAdapterStates();

      // Remove obsolete states from previous versions
      await this.cleanupObsoleteStates();

      // Subscribe to state changes (own states)
      this.subscribeStates("*");
      this.log.debug("Subscribed to own states (pattern: *)");

      this.log.info(
        `Hue Emulator running on ${emulatorConfig.host}:${emulatorConfig.port}${emulatorConfig.https ? " (HTTPS)" : ""}, ${devices.length} device(s)`,
      );
    } catch (error) {
      this.log.error(`Failed to start Hue Emulator: ${errText(error)}`);
    }
  }

  /**
   * Build emulator configuration from adapter config
   */
  private async buildConfig(): Promise<HueEmulatorConfig> {
    // Parse configuration values
    const host = this.config.host?.trim() || "";
    // v1.4.3 (E2): empty host means SSDP advertises an empty location AND
    // Fastify binds to 0.0.0.0 — Hue clients can't connect to the bridge.
    // Surface this immediately instead of starting a half-broken adapter.
    if (!host) {
      throw new Error("Bridge host is empty — set 'host' in admin config to the IP that clients should reach");
    }
    const port = this.toPort(this.config.port);
    const discoveryHost = this.config.discoveryHost?.trim() || host;
    const discoveryPort = this.toPort(this.config.discoveryPort) || port;
    const httpsPort = parsePort(this.config.httpsPort);
    // v1.4.3 (SV4): port collision check — a same-port HTTP+HTTPS pair would
    // make the second listen() throw EADDRINUSE much later, easier to debug
    // when surfaced here.
    if (httpsPort !== undefined && httpsPort === port) {
      throw new Error(`HTTPS port ${httpsPort} equals HTTP port — pick a different port`);
    }
    const udn = this.config.udn?.trim() || uuid.v4();
    const mac = this.config.mac?.trim() || macFromUdn(udn);

    // Persist generated UDN/MAC so identity stays stable across restarts
    if (!this.config.udn?.trim() || !this.config.mac?.trim()) {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { udn, mac },
      });
    }
    const upnpPort = 1900;

    // Build bridge identity
    const identity: BridgeIdentity = {
      udn,
      mac,
      bridgeId: generateBridgeId(mac),
      modelId: BRIDGE_MODEL_ID,
      serialNumber: generateSerialNumber(mac),
    };

    // Build TLS config if HTTPS is enabled
    let https: TlsConfig | undefined;
    if (httpsPort) {
      const { cert, key } = await this.getOrCreateTlsMaterial();
      https = { port: httpsPort, cert, key };
    }

    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`,
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
      identity,
      trustProxy: this.config.trustProxy === true,
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
  private async getOrCreateTlsMaterial(): Promise<{ cert: string; key: string }> {
    const persistedCert = typeof this.config.tlsCert === "string" ? this.config.tlsCert.trim() : "";
    const persistedKey = typeof this.config.tlsKey === "string" ? this.config.tlsKey.trim() : "";
    if (
      persistedCert.startsWith("-----BEGIN CERTIFICATE-----") &&
      (persistedKey.startsWith("-----BEGIN RSA PRIVATE KEY-----") ||
        persistedKey.startsWith("-----BEGIN PRIVATE KEY-----"))
    ) {
      // v1.4.5 (B): parse the persisted cert and check its validity window
      // before reuse. Earlier we only matched the BEGIN-header, so an
      // expired or corrupted cert would silently be handed to Fastify and
      // cause a HTTPS-listen-fail far from the root cause.
      try {
        const parsed = forge.pki.certificateFromPem(persistedCert);
        if (parsed.validity.notAfter > new Date()) {
          this.log.debug(`Reusing persisted TLS certificate (notAfter=${parsed.validity.notAfter.toISOString()})`);
          return { cert: persistedCert, key: persistedKey };
        }
        this.log.warn(
          `Persisted TLS certificate expired (notAfter=${parsed.validity.notAfter.toISOString()}) — regenerating`,
        );
      } catch (err) {
        this.log.warn(`Persisted TLS certificate invalid (${errText(err)}) — regenerating`);
      }
      // fall through to regenerate
    }

    const generated = this.generateCertificate();
    try {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { tlsCert: generated.certificate, tlsKey: generated.privateKey },
      });
      this.log.info("Generated and persisted self-signed TLS certificate (10-year validity)");
    } catch (err) {
      this.log.warn(`TLS cert generated but failed to persist: ${errText(err)} — will regenerate next restart`);
    }
    return { cert: generated.certificate, key: generated.privateKey };
  }

  /**
   * Generate a self-signed certificate for HTTPS
   */
  private generateCertificate(): {
    certificate: string;
    privateKey: string;
  } {
    this.log.debug("Generating self-signed certificate for HTTPS");

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    // v1.4.3 (M5): RFC 5280 wants unique serial numbers across reissues —
    // 16 random bytes (positive, MSB cleared) is the standard approach.
    const serialBytes = randomBytes(16);
    serialBytes[0] &= 0x7f;
    cert.serialNumber = serialBytes.toString("hex");
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
  }

  /**
   * Initialize adapter state values. Object creation is handled by
   * io-package.json:instanceObjects (declared once with translation-objects),
   * so we only need to seed the initial values here.
   */
  private async initializeAdapterStates(): Promise<void> {
    this.pairingEnabled = false;

    // v1.4.3 (M2+M4): strict boolean comparison. Earlier `(val as boolean) || false`
    // was a TS-only cast — at runtime a string `"false"` or `"0"` came back as
    // truthy, leaving auth disabled across restarts.
    const disableAuthState = await this.getStateAsync("disableAuth");
    this._disableAuth = coerceBool(disableAuthState?.val);
  }

  /**
   * Migrate v1.3.x instanceObject names/descriptions from plain English strings
   * to translation objects. instanceObjects are NOT re-applied on adapter
   * upgrade, so this is the only path that backfills translations for users
   * who installed before v1.4.0. Idempotent (logic in {@link runInstanceObjectMigration}).
   */
  private async migrateInstanceObjectNames(): Promise<void> {
    await runInstanceObjectMigration({
      getObjectAsync: id => this.getObjectAsync(id),
      extendObjectAsync: (id, obj) =>
        this.extendObjectAsync(id, obj as ioBroker.SettableObject, { preserve: { common: ["name"] } }),
      log: { debug: msg => this.log.debug(msg) },
    });
  }

  /**
   * Remove states/channels/objects that were removed in newer adapter versions
   */
  private async cleanupObsoleteStates(): Promise<void> {
    await runObsoleteStateCleanup({
      namespace: this.namespace,
      getObjectAsync: id => this.getObjectAsync(id),
      delObjectAsync: id => this.delObjectAsync(id),
      getObjectListAsync: query => this.getObjectListAsync(query),
      log: { debug: msg => this.log.debug(msg) },
    });

    // Migrate "user" folder → "clients" (renamed in v1.2.0)
    await this.migrateUserToClients();
  }

  /**
   * Migrate legacy "user" folder to "clients" folder.
   * Copies paired client states, then removes the old "user" folder.
   */
  private async migrateUserToClients(): Promise<void> {
    const userFolder = await this.getObjectAsync("user");
    if (!userFolder) {
      return;
    }

    // Find all states under user.*
    const children = await this.getObjectListAsync({
      startkey: `${this.namespace}.user.`,
      endkey: `${this.namespace}.user.${ID_RANGE_END}`,
    });

    if (children?.rows && children.rows.length > 0) {
      // Create clients folder first (instanceObjects already declares it with
      // a translation-object name; this is defensive in case it was deleted)
      await this.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: { name: tName("clientsFolder"), type: "meta.folder" },
        native: {},
      });

      // v1.4.3 (M7): per-client migration in parallel — sequential for-loop
      // on a fresh-from-legacy install with many paired Alexa accounts
      // caused noticeable startup delay.
      await Promise.all(
        children.rows.map(async row => {
          const oldId = row.id.replace(`${this.namespace}.`, "");
          const username = oldId.replace("user.", "");
          const newId = `clients.${sanitizeId(username)}`;

          const state = await this.getStateAsync(oldId);

          const obj = row.value;
          await this.setObjectNotExistsAsync(newId, {
            type: "state",
            common: obj.common as ioBroker.StateCommon,
            native: obj.native || {},
          });
          if (state?.val !== undefined && state?.val !== null) {
            await this.setStateAsync(newId, { val: state.val, ack: true });
          }

          await this.delObjectAsync(oldId);
          this.log.debug(`Migrated client ${username}: user → clients`);
        }),
      );
    }

    // Remove old "user" folder
    await this.delObjectAsync("user");
    this.log.info(`Migrated ${children?.rows?.length ?? 0} paired client(s) from "user" to "clients"`);
  }

  /**
   * Create a logger adapter for the modules
   */
  private createLogger(): Logger {
    return {
      debug: (msg: string) => this.log.debug(msg),
      info: (msg: string) => this.log.info(msg),
      warn: (msg: string) => this.log.warn(msg),
      error: (msg: string) => this.log.error(msg),
    };
  }

  /**
   * Called when adapter shuts down
   *
   * @param callback - Callback to invoke when shutdown is complete
   */
  private onUnload(callback: () => void): void {
    try {
      // Clear pairing timeout
      this.clearPairingTimeout();

      // Stop SSDP server
      if (this.ssdpServer) {
        this.ssdpServer.stop();
      }

      // Stop HTTP server (fire-and-forget — onUnload must be sync)
      if (this.hueServer) {
        this.hueServer.stop().catch((err: Error) => this.log.error(`Server stop error: ${errText(err)}`));
      }
    } catch (error) {
      this.log.error(`Error during shutdown: ${errText(error)}`);
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
  private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
    try {
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

      if (id === `${this.namespace}.startPairing`) {
        this.handleStartPairing(state);
      } else if (id === `${this.namespace}.disableAuth`) {
        this.disableAuth = coerceBool(state.val);
      } else if (id.startsWith(this.namespace)) {
        // Acknowledge other own state changes
        this.ackState(id, state.val);
      }
    } catch (err: unknown) {
      this.log.error(`stateChange failed: ${errText(err)}`);
    }
  }

  /**
   * Handle startPairing state change
   *
   * @param state - State containing the pairing toggle value
   */
  private handleStartPairing(state: ioBroker.State): void {
    this.clearPairingTimeout();

    const enabled = coerceBool(state.val);
    this.pairingEnabled = enabled;

    if (enabled) {
      // v1.4.3 (U1+R2): fresh auto-add budget per pairing window — a
      // virtual "press of the link button" resets the per-window cap.
      this.apiHandler?.resetAutoAddBudget();
      const seconds = HueEmu.PAIRING_TIMEOUT_MS / 1000;
      this.log.info(`Pairing mode enabled — waiting for client to connect (${seconds} seconds)`);
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
   * Migrate legacy devices (created via createLight JSON) to admin-configured DeviceConfig format.
   * Legacy devices are ioBroker device objects in the adapter namespace with state/name/data children.
   * After migration, DeviceBindingService uses the existing state objects as foreign states.
   *
   * @returns true if migration was performed (adapter will restart with new config)
   */
  private async migrateLegacyDevices(): Promise<boolean> {
    // Skip if devices are already configured in admin
    if (this.config.devices && this.config.devices.length > 0) {
      return false;
    }

    // Check for legacy device objects in our namespace
    const devices = await this.getDevicesAsync();
    if (devices.length === 0) {
      return false;
    }

    this.log.info(`Found ${devices.length} legacy device(s) — migrating to new configuration`);

    const migratedDevices: DeviceConfig[] = [];

    for (const device of devices) {
      const deviceId = device._id.substring(this.namespace.length + 1);

      try {
        // Read device name from name state or device common.name (type-guarded:
        // state.val can be number/bool, common.name can be a translation object)
        const nameState = await this.getStateAsync(`${deviceId}.name`);
        const nameVal = typeof nameState?.val === "string" ? nameState.val : undefined;
        const commonName = typeof device.common?.name === "string" ? device.common.name : undefined;
        const name = nameVal || commonName || deviceId;

        // Read state channel to find available state keys
        const stateObjects = await this.getStatesOfAsync(deviceId, "state");
        const stateKeys = new Set((stateObjects || []).map(s => s._id.substring(s._id.lastIndexOf(".") + 1)));

        // Determine light type from available states
        const lightType = detectLegacyLightType(stateKeys);

        // Build DeviceConfig with state IDs pointing to existing internal states
        const config: DeviceConfig = { name, lightType };

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

        // v1.4.3 (M6): parallel cleanup of the four legacy wrapper objects.
        // (state.* leaf objects are kept — DeviceBindingService binds to them.)
        await Promise.all([
          this.delObjectAsync(`${deviceId}.name`).catch(() => {}),
          this.delObjectAsync(`${deviceId}.data`).catch(() => {}),
          this.delObjectAsync(`${deviceId}.state`).catch(() => {}),
          this.delObjectAsync(deviceId).catch(() => {}),
        ]);
      } catch (error) {
        this.log.warn(`Could not migrate legacy device ${deviceId}: ${errText(error)}`);
      }
    }

    if (migratedDevices.length === 0) {
      return false;
    }

    // Save migrated devices to adapter config (triggers automatic restart)
    await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
      native: { devices: migratedDevices },
    });

    this.log.info(`Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`);

    return true;
  }

  /**
   * Parse a required port number from admin config (string or number).
   * Throws when the value is missing or unparseable — caller must handle.
   *
   * @param port - Raw port value from config
   */
  private toPort(port: unknown): number {
    const parsed = parsePort(port);
    if (parsed === undefined) {
      throw new Error("Port not specified");
    }
    return parsed;
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new HueEmu(options);
} else {
  // Start the instance directly
  (() => new HueEmu())();
}
