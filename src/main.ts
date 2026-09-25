/**
 * ioBroker Hue Emulator Adapter
 * Emulates a Philips Hue Bridge for smart home integrations
 */

import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import * as uuid from "uuid";

import { HueServer } from "./server";
import { HueSsdpServer, SSDP_PORT } from "./discovery";
import { ApiHandler, type DeviceConfig } from "./hue-api";
import { HueEmuDeviceManagement } from "./device-management";
import { coerceBool, parsePort } from "./lib/coerce";
import { tName, tRaw } from "./lib/i18n";
import { CERT_VALIDITY_YEARS, getOrCreateTlsMaterial } from "./lib/tls-material";
import { normalizeDevices } from "./lib/device-ids";
import {
  ID_RANGE_END,
  runObsoleteStateCleanup,
  runLegacyDeviceMigration,
  runDeviceIdMigration,
} from "./lib/migrations";
import type { HueEmulatorConfig, BridgeIdentity, TlsConfig, Logger } from "./types/config";
import {
  BRIDGE_MODEL_ID,
  detectPrimaryIPv4,
  generateBridgeId,
  generateSerialNumber,
  listIPv4Addresses,
  macFromUdn,
  validateNetworkConfig,
} from "./types/config";
import { ConfigurationError, REASON_UNKNOWN } from "./types/errors";
import { migrateNativeKeys } from "./lib/native-key-migration";
import { buildNativeKeyMigrations } from "./lib/native-key-list";
import { errText, sanitizeId } from "./types/utils";

// Augment the adapter.config object with the actual types
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ioBroker {
    interface AdapterConfig {
      // The listen address — the fleet-standard key the admin's port-conflict check reads
      // together with `port` (v1.18.0; `host` until v1.17.1, migrated on the first start).
      bind: string;
      port: number;
      httpsPort: number | undefined;
      tlsCert?: string;
      tlsKey?: string;
      trustProxy?: boolean;
      udn: string;
      mac: string;
      devices: DeviceConfig[];
      // v1.19.0: the highest light number ever handed out — written by the device
      // manager so a deleted light's number (and uniqueid) is never reused.
      lastLightId?: number;
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
  // v1.12.0: set when buildConfig persisted generated identity or TLS material
  // into native — that write triggers an instance restart (jsonConfig
  // semantics), so onReady short-circuits instead of binding servers the
  // imminent restart would tear down.
  private nativePersistPending = false;
  // v1.18.0: set the moment the host asks us to stop. onReady checks it after
  // every long await: in compact mode the process survives an unload, so a
  // start that carried on would leave a bound server behind for the restarted
  // instance to collide with (audit 2026-09-15 B3).
  private unloaded = false;

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
      // v1.18.0: makes js-controller hand over `system.config` — `this.language`
      // is what names a detected light in the user's language (A3).
      useFormatDate: true,
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

  /**
   * v1.17.0: report whether the emulated bridge is actually serving.
   *
   * Before this, a start that failed — a taken port, no routable IP to advertise
   * — left exactly one line in the log while the instance stayed green in the
   * admin and the whole object tree looked normal. The user had nothing to look
   * at (audit 2026-09-06 F4). The pair follows the fleet rule for a reason text:
   * `Unknown` while the adapter has nothing to report yet, empty while all is
   * well, the real cause otherwise — never "the adapter is stopped", which is
   * the one thing the user can already see.
   *
   * @param connected - Whether the HTTP listener is accepting requests
   * @param reason - The failure to show, or "" when there is none
   */
  private setConnected(connected: boolean, reason: string): void {
    this.ackState("info.connection", connected);
    this.ackState("info.error", reason);
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

  /**
   * Called when the databases are connected and the adapter has its configuration.
   * Top-level try/catch: an async event handler that rejects would take the
   * process down with an unhandled rejection.
   */
  private async onReady(): Promise<void> {
    try {
      // First: without this the whole shutdown path stays dead on an updated install.
      // A correction means the host is restarting us — no point binding anything.
      if (await this.clearStopInstanceFlag()) {
        return;
      }
      await I18n.init(join(this.adapterDir, "admin"), this);
      // v1.19.0: a hand-edited instance object or a restored backup can carry
      // anything here — no list, or `null` entries. Every reader below gets a
      // clean list instead of a TypeError text in info.error (audit 2026-09-25 Q16).
      this.config.devices = normalizeDevices(this.config.devices);
      this.log.debug(`onReady: starting (devices in config: ${this.config.devices.length})`);
      // Nothing to report yet — the listener is not up. Written before anything
      // can fail, so a crash between here and the listen leaves the truth behind.
      this.setConnected(false, REASON_UNKNOWN);

      // v1.18.0: the listen address moved from `host` to the standard key `bind` and
      // the port became a number, so the admin's port-conflict check sees this bridge.
      // v1.19.0: keys no version reads any more are dropped (advertiseHost is carried
      // into bind first where that keeps the announced address — native-key-list.ts).
      // A write restarts the instance — stop here like every other native migration.
      const migrations = buildNativeKeyMigrations(
        this.config as unknown as Record<string, unknown>,
        listIPv4Addresses().map(a => a.address),
      );
      if (await migrateNativeKeys(this, migrations, errText)) {
        return;
      }

      // Migrate legacy devices (created via createLight) to admin config format
      const migrated = await this.migrateLegacyDevices();
      if (migrated) {
        // Config was updated — adapter will restart automatically
        return;
      }

      // v1.18.0: every light gets its permanent number once (its Hue id and
      // uniqueid used to be its position — deleting one light re-identified all
      // the others for Alexa). Same restart contract as the migrations above.
      if (await runDeviceIdMigration(this, this.config.devices || [])) {
        return;
      }

      // Carry the manifest's own objects into an EXISTING tree (js-controller
      // creates them only where they are missing).
      await this.refreshInstanceObjects();
      if (this.unloaded) {
        return;
      }

      // Parse and validate configuration
      const emulatorConfig = await this.buildConfig();

      // v1.12.0: buildConfig may persist generated identity or TLS material into
      // native, which triggers an instance restart (jsonConfig semantics).
      // Short-circuit like the legacy migration so we don't bind servers the
      // imminent restart would immediately tear down.
      if (this.nativePersistPending) {
        this.log.info("Persisted generated bridge identity/TLS — restarting with the stored configuration.");
        return;
      }
      if (this.unloaded) {
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

      // No cast: the handler interfaces declare their write calls as
      // `Promise<unknown>`, so the adapter satisfies them structurally and the
      // compiler keeps watching this boundary (v1.17.0 — it used to be an
      // `as unknown as ApiHandlerAdapter`, which switched every check off).
      this.apiHandler = this.makeApiHandler({
        adapter: this,
        configServiceConfig: {
          identity: emulatorConfig.identity,
          advertiseHost: emulatorConfig.advertiseHost,
        },
        devices,
        logger,
      });

      // Initialize API handler (sets up state subscriptions for device bindings)
      await this.apiHandler.initialize();
      if (this.unloaded) {
        return;
      }

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
      if (this.unloaded) {
        // The stop request came while the listener was binding — it was not there
        // to be stopped then, so release it now instead of leaving it behind.
        await this.hueServer.stop();
        return;
      }
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

      this.setConnected(true, "");
      this.log.info(
        `Hue Emulator running, reachable at ${emulatorConfig.advertiseHost}:${emulatorConfig.port}${emulatorConfig.https ? " (HTTPS)" : ""}, ${devices.length} device(s)`,
      );
    } catch (error) {
      const detail = errText(error);
      // The reason datapoint never carries hueemu's OWN wording — a text the
      // adapter invented about itself is `Unknown` there, fleet-wide. Only a
      // message from outside (node's `listen EADDRINUSE …`) names a cause the
      // user could not have read off the instance state anyway. The full text,
      // hint included, goes to the log where it is actionable.
      this.setConnected(false, error instanceof ConfigurationError ? REASON_UNKNOWN : detail);
      this.log.error(`Failed to start Hue Emulator: ${detail}`);
    }
  }

  /**
   * Build emulator configuration from adapter config
   */
  private async buildConfig(): Promise<HueEmulatorConfig> {
    // Parse configuration values
    const bind = this.config.bind?.trim() || "0.0.0.0";
    const port = this.toPort(this.config.port);
    // v1.12.0: one Host/IP selector is bind AND advertise. A concrete address is
    // announced as-is (SSDP location / description.xml / config); "0.0.0.0"
    // (listen on all interfaces) auto-detects a routable IP to announce, never
    // advertising 0.0.0.0. (The pre-1.12 advertiseHost field is migrated into bind
    // or dropped on the first start of v1.19.0 — native-key-list.ts.)
    const advertiseHost = bind !== "0.0.0.0" ? bind : detectPrimaryIPv4();
    if (bind === "0.0.0.0" && advertiseHost) {
      // The address clients are told to use is a choice the adapter made — say
      // which one, so a wrong pick (a docker bridge, a VPN tunnel) is visible in
      // the log instead of only in "Alexa cannot find the bridge".
      const iface = listIPv4Addresses().find(a => a.address === advertiseHost);
      this.log.info(
        `Announcing ${advertiseHost}${iface ? ` (interface ${iface.iface})` : ""} to clients — set Host/IP in the settings to override`,
      );
    }
    const httpsPort = parsePort(this.config.httpsPort);
    // v1.9.0: the bind host may be 0.0.0.0 (listen on all interfaces); what must
    // resolve is a routable advertiseHost. v1.4.3 (SV4): an HTTPS port equal to
    // the HTTP port makes the second listen() throw EADDRINUSE far from the
    // cause. Both surfaced up-front via validateNetworkConfig.
    validateNetworkConfig(advertiseHost, port, httpsPort);
    const udn = this.config.udn?.trim() || uuid.v4();
    const mac = this.config.mac?.trim() || macFromUdn(udn);

    // Everything generated on this start is stored in ONE merge below — the
    // identity and, when HTTPS is on, the certificate. v1.18.0: they used to be
    // two writes, and the second one (plus the RSA keygen before it) happened
    // for a process that the first write had already committed to restarting
    // (audit 2026-09-15 B4).
    const generated: Record<string, string> = {};
    if (!this.config.udn?.trim() || !this.config.mac?.trim()) {
      generated.udn = udn;
      generated.mac = mac;
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
      const material = getOrCreateTlsMaterial(this.config.tlsCert, this.config.tlsKey, this.log);
      if (material.generated) {
        generated.tlsCert = material.cert;
        // v1.19.0: `tlsKey` is in `encryptedNative` — js-controller DECRYPTS it before
        // `ready` and turns a plaintext PEM into garbage (decryptLegacy). Stored in
        // plaintext (v1.4.7–v1.18.0) the key was unreadable on the next start, a new
        // certificate was generated and persisted, the instance restarted — for ever,
        // and HTTP never bound either (audit 2026-09-25 K1). Encrypt what is stored;
        // this run serves with the plaintext it holds in memory.
        generated.tlsKey = this.encrypt(material.key);
      }
      https = { port: httpsPort, cert: material.cert, key: material.key };
    }

    if (Object.keys(generated).length > 0) {
      // Persist so identity and certificate stay stable across restarts. A failed
      // write is not fatal: this run serves with the generated values and the
      // next start generates (and tries to store) again.
      try {
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, { native: generated });
        this.nativePersistPending = true;
        if (generated.tlsCert) {
          this.log.info(`Generated and persisted self-signed TLS certificate (${CERT_VALIDITY_YEARS}-year validity)`);
        }
      } catch (error) {
        this.log.warn(
          `Generated bridge identity/TLS material could not be stored (${errText(error)}) — using it for this run`,
        );
      }
    }

    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`,
    );
    this.log.debug(
      `Network: bind=${bind}:${port}, advertise=${advertiseHost}, SSDP=:${SSDP_PORT}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`,
    );
    this.log.debug(`UDN: ${identity.udn}`);

    return {
      bind,
      port,
      advertiseHost,
      https,
      identity,
      trustProxy: this.config.trustProxy === true,
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

  /** Stop the ssdp:alive pulse — on unload and when the SSDP socket dies. */
  private stopSsdpAnnounce(): void {
    if (this.ssdpAnnounceInterval !== undefined) {
      this.clearInterval(this.ssdpAnnounceInterval);
      this.ssdpAnnounceInterval = undefined;
    }
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
          reject(err instanceof Error ? err : new Error(errText(err), { cause: err }));
        },
      );
    });
  }

  /**
   * Re-apply the NAME and DESCRIPTION of the adapter's own objects on every start.
   *
   * js-controller (7.2.2, `_createInstancesObjects`) applies the manifest's
   * `instanceObjects` on every start — type, role, read/write, def all reach an
   * existing tree from the manifest — but with `preserve: { common: ['name'] }`:
   * a changed NAME never reaches an installation that already has the object
   * (`reference_iobroker_bestehende_objekte_erreichen`). `extendObject` carries
   * the translated name and the description; the shape itself lives in the
   * manifest alone (fleet rule), so nothing here can drift from it.
   *
   * This replaces the v1.4.0 name migration, which only ever patched an object
   * whose name was still the exact pre-1.4.0 English default — every later text
   * change was invisible to existing installations. The adapter owns its own
   * datapoints, so it writes them unconditionally.
   */
  private async refreshInstanceObjects(): Promise<void> {
    await this.extendObject("startPairing", {
      common: { name: tName("startPairingName"), desc: tName("startPairingDesc") },
    });
    await this.extendObject("disableAuth", {
      common: { name: tName("disableAuthName"), desc: tName("disableAuthDesc") },
    });
    await this.extendObject("info", { common: { name: tName("infoFolder") } });
    await this.extendObject("info.connection", {
      common: { name: tName("infoConnectionName"), desc: tName("infoConnectionDesc") },
    });
    await this.extendObject("info.error", {
      common: { name: tName("infoErrorName"), desc: tName("infoErrorDesc") },
    });
    // v1.17.0: a `folder`, not a `meta` object. The paired clients are states,
    // and repochecker's object-structure rule counts `meta` as a NON-hierarchy
    // type — a state under it makes the whole branch an E2001 ("hierarchy
    // contains non-hierarchy object types", `HIERARCHY_TYPES` in
    // config_StateRoles.js is device/channel/state/folder). The object type is
    // part of that migration, not of the shape copy: it stays here until no
    // installation older than v1.17.0 is left.
    await this.extendObject("clients", {
      type: "folder",
      common: { name: tName("clientsFolder"), desc: tName("clientsFolderDesc") },
    });
    await this.dropClientsFolderType();
    this.log.debug("Refreshed the adapter's own objects (names/descriptions reach existing installations)");
    await this.refreshClientNames();
  }

  /**
   * Drop the `common.type` the pre-v1.17.0 `meta` object carried ("meta.folder").
   * A `FolderCommon` has no `type` at all, and an extendObject merge would keep
   * the stale value for ever.
   *
   * Why not `extendObject(… { common: { type: null } })`, the fleet's usual way of
   * deleting a common field: js-controller validates the incoming PATCH before the
   * null-means-delete semantics apply, sees `typeof null === "object"` and logs
   * `Object clients is invalid: obj.common.type has an invalid type! Expected
   * "string", received "object" This will throw an error up from js-controller
   * version 7.0.0` — on EVERY start of EVERY installation, fresh ones included
   * (measured against js-controller 7.2.3, 2026-09-06). The value did get deleted,
   * but at the price of a warning in every user's log and an announced hard error.
   *
   * So: read first, and rewrite only when the field is really there — the copy
   * without the key, written back whole with `setForeignObject` under the full id
   * (v1.19.0; `setObject`/`setObjectAsync` is the whole-object write the repository
   * checker refuses, and delete + recreate would drop the enum memberships). No
   * merge, nothing to validate — and on an installation that never had a meta
   * object nothing happens at all.
   */
  private async dropClientsFolderType(): Promise<void> {
    try {
      const clients = await this.getObjectAsync("clients");
      if (!clients?.common || !("type" in clients.common)) {
        return;
      }
      const common = { ...clients.common } as Record<string, unknown>;
      delete common.type;
      await this.setForeignObject(`${this.namespace}.clients`, {
        ...clients,
        common,
      } as unknown as ioBroker.SettableFolderObject);
      this.log.debug("Removed the stale common.type from the clients folder");
    } catch (error) {
      // Cosmetic cleanup — a failure here must never stop the start.
      this.log.debug(`Could not clean up the clients folder: ${errText(error)}`);
    }
  }

  /**
   * v1.15.1: turn the name of an ALREADY PAIRED client into a translation object.
   *
   * A client object is created once, with `setObjectNotExists`, and never touched
   * again — so the bare-string name that versions before 1.15.1 wrote stays in the
   * tree for the life of the pairing. `common.name` is a translation object for
   * every object type, even where the text comes from the device and has nothing
   * to translate (core team, nut2 #15). Measured on the live tree 2026-09-03: both
   * paired clients still carried a bare string.
   *
   * Only converts — the text itself is the client's own device type and is kept
   * exactly as it is. An object whose name is already an object is left alone.
   */
  private async refreshClientNames(): Promise<void> {
    let converted = 0;
    try {
      const clients = await this.getStatesOfAsync("clients", undefined);
      for (const client of clients ?? []) {
        const name = client.common?.name;
        const hasDesc = client.common?.desc !== undefined;
        // Nothing to do once the name is a translation object AND the
        // description is there — an already-converted client is left alone.
        if (typeof name !== "string" && hasDesc) {
          continue;
        }
        const id = client._id.substring(this.namespace.length + 1);
        await this.extendObject(id, {
          common: {
            ...(typeof name === "string" ? { name: tRaw(name) } : {}),
            desc: tName("clientDesc"),
          },
        });
        converted++;
      }
    } catch (error) {
      // A failure here must not stop the adapter — the pairing keeps working.
      this.log.debug(`Could not refresh the paired-client names: ${errText(error)}`);
      return;
    }
    if (converted > 0) {
      this.log.debug(`Brought ${converted} paired client object(s) up to the current name/description standard`);
    }
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
        type: "folder",
        common: { name: tName("clientsFolder"), desc: tName("clientsFolderDesc") },
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
          // The old object's `common` is carried over, but its name and
          // description are lifted to the current standard right here. The
          // client refresh in `refreshInstanceObjects` has already run by this
          // point (it sits early in onReady, this migration late), so without
          // this the migrated object would carry a bare string until the NEXT
          // start — one restart of nothing but wrong text in the tree.
          const legacyCommon = obj.common as ioBroker.StateCommon;
          await this.setObjectNotExistsAsync(newId, {
            type: "state",
            common: {
              ...legacyCommon,
              name: typeof legacyCommon.name === "string" ? tRaw(legacyCommon.name) : legacyCommon.name,
              desc: tName("clientDesc"),
            },
            native: obj.native || {},
          });
          if (state?.val !== undefined && state?.val !== null) {
            await this.setState(newId, { val: state.val, ack: true });
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
    this.unloaded = true;
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
      // The bridge is gone — say so before the callback, or the write never
      // reaches the database (the host allows one second, then kills).
      await this.setState("info.connection", { ack: true, val: false });
      await this.setState("info.error", { ack: true, val: REASON_UNKNOWN });
    })()
      .catch((error: unknown) => {
        this.log.error(`Error during shutdown: ${errText(error)}`);
      })
      .finally(callback);
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
        // A bound light must not keep serving the last value of a datapoint
        // that no longer exists (audit 2026-09-15 C2).
        this.apiHandler?.forgetState(id);
        return;
      }

      this.log.debug(`State ${id} changed: ${state.val} (ack = ${state.ack})`);

      // Update the light cache for every change of a bound datapoint, confirmed
      // or not. v1.18.0: an unconfirmed (ack:false) change used to be ignored —
      // but a datapoint nobody confirms (0_userdata, a script, vis) never sends
      // anything else, so such a light stood still in the bridge, while the
      // adapter's own commands were cached optimistically all along. The cache
      // shows what ioBroker shows; the device's confirmed answer still corrects
      // it (audit 2026-09-15 C1, decision 26).
      if (this.apiHandler) {
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
        this.pairingEnabled = false;
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
      throw new ConfigurationError("Port not specified");
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
