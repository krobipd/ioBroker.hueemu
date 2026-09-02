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
import { HueSsdpServer, SSDP_PORT } from "./discovery";
import { ApiHandler, type ApiHandlerAdapter, type DeviceConfig } from "./hue-api";
import { HueEmuDeviceManagement } from "./device-management";
import { coerceBool, parsePort } from "./lib/coerce";
import { tName } from "./lib/i18n";
import {
  ID_RANGE_END,
  runInstanceObjectMigration,
  runObsoleteStateCleanup,
  runLegacyDeviceMigration,
} from "./lib/migrations";
import type { HueEmulatorConfig, BridgeIdentity, TlsConfig, Logger } from "./types/config";
import {
  BRIDGE_MODEL_ID,
  detectPrimaryIPv4,
  generateBridgeId,
  generateSerialNumber,
  macFromUdn,
  validateNetworkConfig,
} from "./types/config";
import { errText, sanitizeId } from "./types/utils";

// Augment the adapter.config object with the actual types
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ioBroker {
    interface AdapterConfig {
      host: string;
      port: number;
      // Legacy (v1.11 and earlier): a separate "advertised IP" field. The single
      // Host/IP selector is now bind + advertise; this is still read for
      // back-compat so existing configs keep their announced IP.
      advertiseHost?: string;
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
  // v1.10.0 (H1): bound the awaited SSDP start. Originally a hard requirement —
  // node-ssdp could hang forever on a swallowed 1900 bind error; the hand-built
  // server (v1.13.0) settles deterministically, so this is now defense in depth
  // (fakeroku keeps the same belt-and-braces bound). 5s is far above a local bind.
  private static readonly SSDP_START_TIMEOUT_MS = 5_000;
  // The ssdp:alive pulse cadence — node-ssdp's adInterval option, now an
  // adapter-managed interval (fleet timer rule).
  private static readonly SSDP_AD_INTERVAL_MS = 10_000;

  private pairingTimeoutId: ioBroker.Timeout | undefined = undefined;
  private ssdpAnnounceInterval: ioBroker.Interval | undefined = undefined;
  private _pairingEnabled = false;
  private _disableAuth = false;
  // v1.12.0: set when buildConfig / getOrCreateTlsMaterial persist generated
  // identity or TLS material into native — that write triggers an instance
  // restart (jsonConfig semantics), so onReady short-circuits instead of binding
  // servers the imminent restart would tear down.
  private nativePersistPending = false;

  private hueServer: HueServer | null = null;
  private ssdpServer: HueSsdpServer | null = null;
  private apiHandler: ApiHandler | null = null;

  // v1.11.0: official ioBroker device-manager backend for the devices tab
  // (manual add/edit/delete + a "search lights" assistant). Instantiated in the
  // constructor as required by dm-utils; it owns no state, it reads/writes
  // native.devices via this adapter.
  private readonly deviceManagement: HueEmuDeviceManagement;

  /**
   * Factories for the server/discovery/API collaborators — default to the
   * real constructors. Test seams (fleet pattern, see
   * `reference_orchestration_test_harness`): the orchestration unit tests
   * replace these with fakes to exercise onReady/onStateChange/onUnload
   * without binding real ports or speaking SSDP.
   *
   * @param options Constructor options of the respective collaborator
   */
  private makeHueServer: (options: ConstructorParameters<typeof HueServer>[0]) => HueServer = options =>
    new HueServer(options);
  private makeSsdpServer: (options: ConstructorParameters<typeof HueSsdpServer>[0]) => HueSsdpServer = options =>
    new HueSsdpServer(options);
  private makeApiHandler: (options: ConstructorParameters<typeof ApiHandler>[0]) => ApiHandler = options =>
    new ApiHandler(options);

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

    this.deviceManagement = new HueEmuDeviceManagement(this);
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
  /**
   * Switch off `supportedMessages.stopInstance` on this instance's own object.
   *
   * The entry was dropped from the manifest, which only helps a FRESH install: an upgrade
   * merges the manifest into the existing instance object and never removes a key, so the old
   * `true` survives in the database — and that is what the host reads. With it the host kills
   * the process one second after asking it to stop, `onUnload` never runs, and the bye-bye
   * datagrams that tell Alexa & friends the bridge is gone never leave (measured on a live
   * js-controller 7.2.2). `deviceManager` stays untouched — the device view needs it.
   *
   * Only written when it is actually still on: every instance-object change restarts the
   * instance, so doing it unconditionally would be a restart loop.
   *
   * @returns true when the correction was written and the restart is coming — the caller has
   *   to stop right there instead of binding ports in a process that is going down.
   */
  private async clearStopInstanceFlag(): Promise<boolean> {
    const id = `system.adapter.${this.namespace}`;
    try {
      const obj = await this.getForeignObjectAsync(id);
      const supported = obj?.common?.supportedMessages as { stopInstance?: unknown } | undefined;
      if (!supported?.stopInstance) {
        return false;
      }
      this.log.info("Correcting a leftover setting from an earlier version — this instance restarts once");
      await this.extendForeignObjectAsync(id, { common: { supportedMessages: { stopInstance: false } } });
      return true;
    } catch (error) {
      // Objects DB unreachable — not worth failing the start over; the next start retries.
      this.log.debug(`Could not check the instance object ${id}: ${errText(error)}`);
      return false;
    }
  }

  private async onReady(): Promise<void> {
    try {
      // First: without this the whole shutdown path stays dead on an updated install.
      // A correction means the host is restarting us — no point binding anything.
      if (await this.clearStopInstanceFlag()) {
        return;
      }
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

      // v1.12.0: buildConfig / getOrCreateTlsMaterial may persist generated
      // identity or TLS material into native, which triggers an instance restart
      // (jsonConfig semantics). Short-circuit like the legacy migration so we
      // don't bind servers the imminent restart would immediately tear down.
      if (this.nativePersistPending) {
        this.log.info("Persisted generated bridge identity/TLS — restarting with the stored configuration.");
        return;
      }

      // Create logger adapter
      const logger = this.createLogger();

      // Get device configurations from admin UI
      const devices: DeviceConfig[] = this.config.devices || [];

      // Initialize SSDP discovery server
      this.ssdpServer = this.makeSsdpServer({
        identity: emulatorConfig.identity,
        host: emulatorConfig.advertiseHost,
        port: emulatorConfig.port,
        logger,
        // A socket death after a good start kills discovery for good — stop the
        // announce pulse instead of multicasting into a closed socket every 10s.
        onFatalError: () => this.stopSsdpAnnounce(),
      });

      // Double cast `unknown → ApiHandlerAdapter` because the Adapter base
      // class's `setStateAsync` returns `SetStatePromise` while our handler
      // interfaces specify `Promise<{ id: string }>`. They are semantically
      // equivalent for our usage; the explicit cast keeps the intent visible
      // without `any`.
      this.apiHandler = this.makeApiHandler({
        adapter: this as unknown as ApiHandlerAdapter,
        configServiceConfig: {
          identity: emulatorConfig.identity,
          advertiseHost: emulatorConfig.advertiseHost,
        },
        devices,
        logger,
      });

      // Initialize API handler (sets up state subscriptions for device bindings)
      await this.apiHandler.initialize();

      // Initialize HTTP server
      this.hueServer = this.makeHueServer({
        config: emulatorConfig,
        handler: this.apiHandler,
        logger,
      });

      // v1.10.0 (L1): restore persisted flags (disableAuth) BEFORE the HTTP
      // listener opens, so a request landing in the boot window is evaluated
      // against the operator's config, not the field default. Pure in-memory
      // restore (no listener/SSDP dependency); still ahead of subscribeStates.
      await this.initializeAdapterStates();

      // v1.4.3 (S2): start HTTP first. SSDP port 1900 is shared by many
      // discovery adapters (shelly, tradfri, ...) — if it's already bound,
      // SSDP throws and we still want the Hue API reachable for clients
      // configured by manual IP. Log SSDP-failure but don't break the adapter.
      await this.hueServer.start();
      try {
        await this.startSsdpWithTimeout();
        // Wake-up advertise + the periodic pulse (node-ssdp's internal ad loop,
        // now adapter-owned so unload can clear it synchronously).
        this.ssdpServer?.announce();
        this.ssdpAnnounceInterval = this.setInterval(() => this.ssdpServer?.announce(), HueEmu.SSDP_AD_INTERVAL_MS);
      } catch (err) {
        this.log.warn(
          `SSDP discovery disabled — port 1900 unavailable (${errText(err)}). HTTP API still reachable; configure clients with the bridge IP manually.`,
        );
      }

      // Remove obsolete states from previous versions. Own fence: this runs after
      // the servers are up, and a failure here must not skip the state
      // subscription below (HTTP alive but startPairing/disableAuth dead).
      try {
        await this.cleanupObsoleteStates();
      } catch (error) {
        this.log.warn(`Cleanup of objects from earlier versions failed — continuing without it: ${errText(error)}`);
      }

      // Subscribe to state changes (own states)
      this.subscribeStates("*");
      this.log.debug("Subscribed to own states (pattern: *)");

      this.log.info(
        `Hue Emulator running, reachable at ${emulatorConfig.advertiseHost}:${emulatorConfig.port}${emulatorConfig.https ? " (HTTPS)" : ""}, ${devices.length} device(s)`,
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
    const host = this.config.host?.trim() || "0.0.0.0";
    const port = this.toPort(this.config.port);
    // v1.12.0: one Host/IP selector is bind AND advertise. A concrete host is
    // announced as-is (SSDP location / description.xml / config); "0.0.0.0"
    // (listen on all interfaces) auto-detects a routable IP to announce, never
    // advertising 0.0.0.0. Legacy configs that still carry a separate
    // advertiseHost keep working — honoured only when the host is 0.0.0.0.
    const legacyAdvertise = typeof this.config.advertiseHost === "string" ? this.config.advertiseHost.trim() : "";
    const advertiseHost =
      host !== "0.0.0.0"
        ? host
        : legacyAdvertise && legacyAdvertise !== "0.0.0.0"
          ? legacyAdvertise
          : detectPrimaryIPv4();
    const httpsPort = parsePort(this.config.httpsPort);
    // v1.9.0: the bind host may be 0.0.0.0 (listen on all interfaces); what must
    // resolve is a routable advertiseHost. v1.4.3 (SV4): an HTTPS port equal to
    // the HTTP port makes the second listen() throw EADDRINUSE far from the
    // cause. Both surfaced up-front via validateNetworkConfig.
    validateNetworkConfig(advertiseHost, port, httpsPort);
    const udn = this.config.udn?.trim() || uuid.v4();
    const mac = this.config.mac?.trim() || macFromUdn(udn);

    // Persist generated UDN/MAC so identity stays stable across restarts
    if (!this.config.udn?.trim() || !this.config.mac?.trim()) {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: { udn, mac },
      });
      this.nativePersistPending = true;
    }

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
    this.log.debug(
      `Network: bind=${host}:${port}, advertise=${advertiseHost}, SSDP=:${SSDP_PORT}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`,
    );
    this.log.debug(`UDN: ${identity.udn}`);

    return {
      host,
      port,
      advertiseHost,
      https,
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
      this.nativePersistPending = true;
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
  private stopSsdpAnnounce(): void {
    if (this.ssdpAnnounceInterval !== undefined) {
      this.clearInterval(this.ssdpAnnounceInterval);
      this.ssdpAnnounceInterval = undefined;
    }
  }

  private async startSsdpWithTimeout(): Promise<void> {
    const ssdp = this.ssdpServer;
    if (!ssdp) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = this.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(
          new Error(
            `SSDP start timed out after ${HueEmu.SSDP_START_TIMEOUT_MS}ms — port 1900 is likely held by another process`,
          ),
        );
      }, HueEmu.SSDP_START_TIMEOUT_MS);
      // Clear the managed timer whichever way start() settles, so a successful
      // start doesn't leave the timeout to reject later (unhandled rejection).
      void ssdp.start().then(
        () => {
          if (settled) {
            return;
          }
          settled = true;
          this.clearTimeout(timer);
          resolve();
        },
        (err: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          this.clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
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
      extendObjectAsync: (id, obj) => this.extendObjectAsync(id, obj as ioBroker.SettableObject),
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
      // The announce pulse must not outlive the server.
      this.stopSsdpAnnounce();

      // Say goodbye on the network, THEN report done. The bye-bye datagrams are what tell
      // Alexa & friends the bridge is gone; calling back first means the host tears the
      // process down while they are still in the socket and the clients keep the bridge
      // until their own timeout. No own deadline needed — the host already has one
      // (`common.stopTimeout`), and `this.setTimeout` refuses during shutdown anyway.
      void (async (): Promise<void> => {
        await this.ssdpServer?.stop();
        await this.hueServer?.stop();
      })()
        .catch((error: unknown) => {
          this.log.error(`Error during shutdown: ${errText(error)}`);
        })
        .finally(callback);
      return;
    } catch (error) {
      this.log.error(`Error during shutdown: ${errText(error)}`);
    }
    callback();
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
   * Migrate legacy devices (created via createLight JSON) to admin-configured
   * DeviceConfig format. Thin wrapper over the pure {@link runLegacyDeviceMigration}
   * helper (extracted to `lib/migrations.ts` for direct unit-testing, like the
   * other two migrations).
   *
   * @returns true if migration was performed (adapter will restart with new config)
   */
  private async migrateLegacyDevices(): Promise<boolean> {
    return runLegacyDeviceMigration({
      namespace: this.namespace,
      configuredDevices: this.config.devices,
      getDevicesAsync: () => this.getDevicesAsync(),
      getStateAsync: id => this.getStateAsync(id),
      getStatesOfAsync: (device, channel) => this.getStatesOfAsync(device, channel),
      extendForeignObjectAsync: (id, obj) => this.extendForeignObjectAsync(id, obj),
      delObjectAsync: id => this.delObjectAsync(id),
      log: { info: msg => this.log.info(msg), warn: msg => this.log.warn(msg) },
    });
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
