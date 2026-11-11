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
import {
  IDENTITY_FILE,
  plainKeyOf,
  readIdentity,
  resolveIdentity,
  type StoredIdentity,
  writeIdentity,
} from "./lib/identity-store";
import { runObsoleteStateCleanup, runLegacyDeviceMigration, runLightObjectMigration } from "./lib/migrations";
import { LightStore, type StoredLights } from "./lib/light-store";
import { CLIENTS_FILE, ClientStore, UNREADABLE_CLIENTS_FILE } from "./lib/client-store";
import { moveClients } from "./lib/client-move";
import { lightIcon } from "./lib/device-icons";
import { KnownObjects, sameStructure } from "./lib/known-objects";
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
import { carriesAddress, chosenAddress, isOwnPeer } from "./lib/network-address";
import { buildNativeKeyMigrations } from "./lib/native-key-list";
import { errText } from "./lib/err-text";

/**
 * Hue Emulator Adapter
 */
class HueEmu extends utils.Adapter {
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
  // Audit R-24: the bridge identity of this start, kept in the instance data folder
  // (identity-store.ts) — loaded before the native migrations, which drop its old copy.
  private identity: StoredIdentity = { udn: "" };
  // v1.18.0: set the moment the host asks us to stop. onReady checks it after
  // every long await: in compact mode the process survives an unload, so a
  // start that carried on would leave a bound server behind for the restarted
  // instance to collide with (audit 2026-09-15 B3).
  private unloaded = false;

  // Audit R-24: the lights as own device objects (`lights.<n>`) — created in onReady, shared with the device manager
  // so every change to them runs through one queue.
  private lights: LightStore | undefined;
  /** The light list the bridge serves right now — a reload that reads the same list changes nothing. */
  private servedLights: DeviceConfig[] = [];
  /**
   * Whether the served lights are the light objects. False for a run whose move out of the settings failed: it
   * serves the settings' lights and reloads nothing — a light object changed meanwhile is served from the next start
   * on.
   */
  private lightsAreObjects = false;
  /** The running reload of the light list, and whether another change came in meanwhile. */
  private lightReload: Promise<void> | undefined;
  private lightReloadAgain = false;

  private hueServer: HueServer | null = null;
  private ssdpServer: HueSsdpServer | null = null;
  private apiHandler: ApiHandler | null = null;

  // v1.11.0: official ioBroker device-manager backend for the devices tab
  // (manual add/edit/delete + a "search lights" assistant). It owns no state: it
  // reads and writes the light objects through the light store.
  // Constructed in onReady after I18n.init: dm-utils listens for messages from its
  // constructor on, and a handler that translates before I18n.init throws.
  private deviceManagement: HueEmuDeviceManagement | undefined;
  /**
   * The address chosen in the settings, undefined for every address (fleet master
   * network-address.ts) — set by buildConfig, read by the trust boundary.
   */
  private bindIp: string | undefined;

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
    this.on("objectChange", this.onObjectChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /**
   * The trust boundary of both services: a client in one of the host's own networks — with a
   * chosen address only in that address's network. Read fresh on every question, so an
   * address change is followed instead of frozen at start-up.
   *
   * @param address the client address
   * @returns true if the client may be answered
   */
  private readonly isOwnClient = (address: string | undefined): boolean => isOwnPeer(address, this.bindIp);

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
    void this.writeAcked(id, val);
  }

  /**
   * The ack write {@link ackState} starts, to wait for — before the process ends. Never rejects.
   *
   * @param id - State id (relative to namespace)
   * @param val - Value to write with ack:true
   */
  private async writeAcked(id: string, val: ioBroker.StateValue): Promise<void> {
    try {
      await this.setState(id, { ack: true, val });
    } catch (e) {
      this.log.error(`setState ${id} failed: ${errText(e)}`);
    }
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
   * @returns when both writes are done — never rejects
   */
  private async setConnected(connected: boolean, reason: string): Promise<void> {
    await Promise.all([this.writeAcked("info.connection", connected), this.writeAcked("info.error", reason)]);
  }

  /** Whether authentication is disabled */
  get disableAuth(): boolean {
    return this._disableAuth;
  }

  /** Set authentication disabled flag and persist */
  set disableAuth(value: boolean) {
    this._disableAuth = value;
    this.ackState("disableAuth", value);
    this.log.debug(value ? "Authentication disabled (all requests allowed)" : "Authentication enabled");
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
      // First of all: js-controller delivers messages before onReady has finished,
      // and every handler translates (iobroker-adapter-checks i18n-before-messages).
      await I18n.init(join(this.adapterDir, "admin"), this);
      // Unknown messages get an answer (D10) — after I18n.init like every message handler (dm-utils' too).
      this.on("message", this.onMessage.bind(this));
      // Next: without this the whole shutdown path stays dead on an updated install.
      // A correction means the host is restarting us — no point binding anything.
      if (await this.clearStopInstanceFlag()) {
        return;
      }
      // Audit R-24: the lights are own device objects, their number mark a file in the data folder.
      const lights = new LightStore(this, this.identityDir(), lightIcon());
      this.lights = lights;
      this.deviceManagement = new HueEmuDeviceManagement(this, lights);
      // Nothing to report yet — the listener is not up. Written before anything
      // can fail, so a crash between here and the listen leaves the truth behind.
      await this.setConnected(false, REASON_UNKNOWN);

      // v1.18.0: the listen address moved from `host` to the standard key `bind` and
      // the port became a number, so the admin's port-conflict check sees this bridge.
      // v1.19.0: keys no version reads any more are dropped (advertiseHost is carried
      // into bind first where that keeps the announced address — native-key-list.ts).
      // A write restarts the instance — stop here like every other native migration.
      // Audit R-24: the identity file is written first, the lights become objects first;
      // only once they hold it are the old copies in native dropped.
      const identityStored = this.loadIdentity();
      const moved = await runLightObjectMigration(
        lights,
        { devices: this.config.devices, lastLightId: this.config.lastLightId },
        this.log,
      );
      const migrations = buildNativeKeyMigrations(
        this.config as unknown as Record<string, unknown>,
        listIPv4Addresses().map(a => a.address),
        identityStored,
        moved.stored,
      );
      if (await migrateNativeKeys(this, migrations, errText)) {
        return;
      }

      // Lights the pre-1.1.0 `createLight` state made become light objects as well.
      let stored = await lights.list();
      if (await this.migrateLegacyDevices(lights, stored.lights.length > 0 || !moved.stored)) {
        stored = await lights.list();
      }
      // A move out of the settings that failed serves the settings' lights this run.
      const devices: DeviceConfig[] = moved.stored ? stored.lights : (moved.devices ?? []);
      this.lightsAreObjects = moved.stored;
      await this.prepareLightObjects(lights, stored, devices);

      // The paired clients: their keys from clients.json, the objects of earlier versions moved to `clients.<id>` —
      // before the own objects are refreshed and before the bridge serves, so the first request reads the moved tree.
      const clients = await this.prepareClients();

      // Carry the names of the manifest's own objects into an EXISTING tree
      // (js-controller merges instanceObjects on every start but keeps common.name).
      await this.refreshInstanceObjects();
      if (this.unloaded) {
        return;
      }

      // Parse and validate configuration
      const emulatorConfig = this.buildConfig();
      if (this.unloaded) {
        return;
      }

      // The adapter's own log is the modules' Logger (it carries the four methods).
      const logger: Logger = this.log;

      // Initialize SSDP discovery server
      this.ssdpServer = this.makeSsdpServer({
        identity: emulatorConfig.identity,
        host: emulatorConfig.advertiseHost,
        port: emulatorConfig.port,
        bindIp: this.bindIp,
        isClientAllowed: this.isOwnClient,
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
        clients,
      });

      // Initialize API handler (sets up state subscriptions for device bindings)
      await this.apiHandler.initialize();
      this.servedLights = devices;
      if (this.unloaded) {
        return;
      }

      // Initialize HTTP server
      this.hueServer = this.makeHueServer({
        config: emulatorConfig,
        handler: this.apiHandler,
        logger,
        isClientAllowed: this.isOwnClient,
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
        if (this.unloaded) {
          // v1.19.0 (audit 2026-09-25 Q18): the stop came while SSDP was binding —
          // release the socket and go, before an interval nobody clears is set up.
          await this.ssdpServer?.stop();
          return;
        }
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
      // …and to the client objects: deleting one in the admin revokes it (v1.19.0, H12).
      this.subscribeObjects("clients.*");
      // …and to the light objects: a light added, edited or deleted is served at once (audit R-24 — a change to
      // them no longer restarts the instance). After every own write of this start, so none of them triggers it.
      if (this.lightsAreObjects) {
        this.subscribeObjects("lights.*");
      }
      this.log.debug("Subscribed to own states (pattern: *), client and light objects");

      // Q18: a stop during the cleanup above must not be followed by "connected".
      if (this.unloaded) {
        return;
      }
      await this.setConnected(true, "");
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
      this.log.error(`Failed to start Hue Emulator: ${detail}`);
      // The bridge serves nothing (D4, like the stop) — that reaches the database before the process ends: a write
      // still in flight at the exit is lost.
      await this.setConnected(false, error instanceof ConfigurationError ? REASON_UNKNOWN : detail);
      // GV-28 (krobi 2026-10-03 12:01): a bridge that serves nothing talks to nobody — a fatal error, never a process
      // that runs on idle. UNCAUGHT_EXCEPTION, not ADAPTER_REQUESTED_TERMINATION: js-controller restarts it after 30 s,
      // so a port that was taken only for a while heals itself, and gives up after three failures in ten minutes; 11
      // would mean "never restart".
      if (!this.unloaded) {
        this.terminate("Hue Emulator could not start", utils.EXIT_CODES.UNCAUGHT_EXCEPTION);
      }
    }
  }

  /**
   * The paired clients' keys and objects for this start (client-store.ts, client-move.ts). A file that cannot be read
   * signs no client in until it pairs again — it is set aside with the next pairing, never overwritten. A move that
   * fails leaves every old object in place, and the next start tries again.
   *
   * @returns the client keys, loaded
   */
  private async prepareClients(): Promise<ClientStore> {
    const clients = new ClientStore(this.identityDir());
    const unusable = clients.load();
    if (unusable !== undefined) {
      this.log.warn(
        `The stored client keys ${join(this.identityDir(), CLIENTS_FILE)} cannot be used (${unusable}) — paired clients must pair again; it is set aside as ${UNREADABLE_CLIENTS_FILE} before the next write`,
      );
    }
    try {
      await moveClients(this, clients, errText);
    } catch (error) {
      this.log.warn(
        `The paired clients could not be brought to the current form — the next start tries again: ${errText(error)}`,
      );
    }
    return clients;
  }

  /**
   * Audit R-24: before the bridge serves — raise the number mark to every light number in the tree (a light deleted
   * in the object browser keeps its number taken) and to every light served this run (a run whose move failed serves
   * the settings' lights, and a light added meanwhile must not take one of their numbers) and bring each light's
   * object to the current form (its pictogram; only what differs is written).
   *
   * @param lights the light store
   * @param stored the light objects as read
   * @param served the lights this run serves
   */
  private async prepareLightObjects(lights: LightStore, stored: StoredLights, served: DeviceConfig[]): Promise<void> {
    try {
      lights.raiseMark([...stored.lights, ...served].map(light => light.id ?? 0));
    } catch (error) {
      this.log.warn(`The light number mark could not be stored: ${errText(error)}`);
    }
    if (!this.lightsAreObjects) {
      return;
    }
    try {
      const written = await lights.reconcile(stored);
      if (written > 0) {
        this.log.debug(`Brought ${written} light object(s) up to the current form`);
      }
    } catch (error) {
      // The lights are served either way; their objects get their form on the next start.
      this.log.warn(`Could not bring the light objects up to date: ${errText(error)}`);
    }
  }

  /**
   * A light object was added, changed or deleted (the device manager, the object browser): read the list again and
   * serve it. One reload at a time; changes that come in meanwhile are read by one more reload after it.
   */
  private scheduleLightReload(): void {
    if (this.lightReload) {
      this.lightReloadAgain = true;
      return;
    }
    this.lightReload = (async (): Promise<void> => {
      do {
        this.lightReloadAgain = false;
        await this.reloadLights();
      } while (this.lightReloadAgain && !this.unloaded);
    })().finally(() => {
      this.lightReload = undefined;
    });
  }

  /** One reload of the light list. Never rejects — a failure keeps the list served so far. */
  private async reloadLights(): Promise<void> {
    const lights = this.lights;
    const handler = this.apiHandler;
    if (!lights || !handler || this.unloaded) {
      return;
    }
    try {
      const { lights: list } = await lights.list();
      try {
        lights.raiseMark(list.map(light => light.id ?? 0));
      } catch (error) {
        this.log.warn(`The light number mark could not be stored: ${errText(error)}`);
      }
      if (sameStructure(list, this.servedLights)) {
        return;
      }
      await handler.replaceDevices(list);
      this.servedLights = list;
      this.log.debug(`Serving ${list.length} light(s) after a change of the light objects`);
    } catch (error) {
      this.log.warn(`Could not apply the changed lights — serving the previous list: ${errText(error)}`);
    }
  }

  /**
   * Audit R-24: the bridge identity for this start — the file in the instance data folder,
   * or on its first start what an earlier version left in native (or a fresh UDN), stored
   * there right away. A file that cannot be written is not fatal: this run serves with the
   * identity it holds, the old copy in native stays, and the next start tries again.
   *
   * @returns whether the file holds the identity — only then are the old copies dropped
   */
  private loadIdentity(): boolean {
    const read = readIdentity(this.identityDir());
    if (read.error) {
      this.log.warn(
        `The stored bridge identity ${join(this.identityDir(), IDENTITY_FILE)} cannot be used (${read.error}) — taking it from the settings or creating a new one`,
      );
    }
    const { identity, unsaved } = resolveIdentity(
      read.identity,
      { udn: this.config.udn, tlsCert: this.config.tlsCert, tlsKey: this.config.tlsKey },
      () => uuid.v4(),
      v => this.encrypt(v),
    );
    this.identity = identity;
    return unsaved ? this.storeIdentity() : true;
  }

  /**
   * Write the identity of this start to its file.
   *
   * @returns whether it was stored
   */
  private storeIdentity(): boolean {
    try {
      writeIdentity(this.identityDir(), this.identity);
      return true;
    } catch (error) {
      this.log.warn(`The bridge identity could not be stored (${errText(error)}) — using it for this run`);
      return false;
    }
  }

  /** The instance data folder (declared as `common.dataFolder`, so a backup carries it). */
  private identityDir(): string {
    return utils.getAbsoluteInstanceDataDir(this);
  }

  /**
   * Build emulator configuration from adapter config
   */
  private buildConfig(): HueEmulatorConfig {
    // Parse configuration values. The fleet master reads "every address" ("", "0.0.0.0",
    // "::"); a chosen address the host does not carry (a new address from the router, a
    // backup restored on other hardware) cannot be served — then every address, and the
    // log says once what to fix (krobi 2026-10-03, network-address.ts).
    let bindIp = chosenAddress(this.config.bind);
    if (bindIp !== undefined && !carriesAddress(bindIp)) {
      this.log.warn(
        `Address ${bindIp} does not exist on this host — listening on all addresses; choose another address in the instance settings`,
      );
      bindIp = undefined;
    }
    this.bindIp = bindIp;
    const bind = bindIp ?? "0.0.0.0";
    const port = this.toPort(this.config.port);
    // v1.12.0: one Host/IP selector is bind AND advertise. A concrete address is
    // announced as-is (SSDP location / description.xml / config); "0.0.0.0"
    // (listen on all interfaces) auto-detects a routable IP to announce, never
    // advertising 0.0.0.0. (The pre-1.12 advertiseHost field is migrated into bind
    // or dropped on the first start of v1.19.0 — native-key-list.ts.)
    const advertiseHost = bindIp ?? detectPrimaryIPv4();
    if (bindIp === undefined && advertiseHost) {
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
    // Type guard at the boundary: a hand-edited instance object can carry a number
    // or null here, and `.trim()` on it stopped the start (audit R-05). An empty MAC
    // is derived from the UDN on every start and never written (audit R-24).
    const udn = this.identity.udn;
    const storedMac = typeof this.config.mac === "string" ? this.config.mac.trim() : "";
    const mac = storedMac || macFromUdn(udn);

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
      const material = getOrCreateTlsMaterial(
        this.identity.tlsCert,
        plainKeyOf(this.identity.tlsKey, v => this.decrypt(v)),
        this.log,
      );
      if (material.generated) {
        // The key is stored encrypted (design decision 8); this run serves with the
        // plaintext it holds in memory.
        this.identity = { ...this.identity, tlsCert: material.cert, tlsKey: this.encrypt(material.key) };
        if (this.storeIdentity()) {
          this.log.info(`Generated and stored self-signed TLS certificate (${CERT_VALIDITY_YEARS}-year validity)`);
        }
      }
      https = { port: httpsPort, cert: material.cert, key: material.key };
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
   * change was invisible to existing installations.
   *
   * The own tree is read once (fleet master `known-objects.ts`) and a text the stored
   * object already carries is not written again: `extendObject` writes, stamps `ts`
   * and wakes every subscriber also when nothing changed (inventory "rewrites no
   * object unchanged").
   */
  private async refreshInstanceObjects(): Promise<void> {
    const known = new KnownObjects(this);
    await known.load();
    await known.extend("startPairing", {
      common: { name: tName("startPairingName"), desc: tName("startPairingDesc") },
    });
    await known.extend("disableAuth", {
      common: { name: tName("disableAuthName"), desc: tName("disableAuthDesc") },
    });
    await known.extend("info", { common: { name: tName("infoFolder") } });
    await known.extend("info.connection", {
      common: { name: tName("infoConnectionName"), desc: tName("infoConnectionDesc") },
    });
    await known.extend("info.error", {
      common: { name: tName("infoErrorName"), desc: tName("infoErrorDesc") },
    });
    // The object type (`folder`, a `meta` until v1.17.0 — decision 24) comes from the
    // manifest alone: js-controller 7.2.2 merges every instanceObjects entry, `type`
    // included, into the existing object on each start (`_extendObjects` →
    // `extendForeignObjectAsync(task._id, task, …)`). Only the stale `common.type` of
    // the old meta object needs removing, below.
    await known.extend("clients", {
      common: { name: tName("clientsFolder"), desc: tName("clientsFolderDesc") },
    });
    await known.extend("lights", {
      common: { name: tName("lightsFolder"), desc: tName("lightsFolderDesc") },
    });
    await this.dropClientsFolderType(known);
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
   * So: rewrite only when the field is really there — the copy without the key,
   * written back whole with `setForeignObject` under the full id (v1.19.0;
   * `setObject`/`setObjectAsync` is the whole-object write the repository checker
   * refuses, and delete + recreate would drop the enum memberships). No merge,
   * nothing to validate — and on an installation that never had a meta object
   * nothing happens at all.
   *
   * @param known the own tree as read at this start
   */
  private async dropClientsFolderType(known: KnownObjects): Promise<void> {
    try {
      const clients = known.get("clients") as ioBroker.Object | undefined;
      if (!clients?.common || !("type" in clients.common)) {
        return;
      }
      const common = { ...clients.common } as Record<string, unknown>;
      delete common.type;
      await known.replace(`${this.namespace}.clients`, {
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
      await Promise.all([
        this.setState("info.connection", { ack: true, val: false }),
        this.setState("info.error", { ack: true, val: REASON_UNKNOWN }),
      ]);
    })()
      .catch((error: unknown) => {
        this.log.error(`Error during shutdown: ${errText(error)}`);
      })
      .finally(callback);
  }

  /**
   * A message gets an answer, never silence (fleet rule D10): the device manager's `dm:` commands are answered by
   * dm-utils, which listens on the same event; any other command is none of this adapter's and gets an error the
   * sender can read. A message without a callback waits for nothing.
   *
   * @param obj - The message
   */
  private onMessage(obj: ioBroker.Message): void {
    try {
      if (!obj?.callback || typeof obj.command !== "string" || obj.command.startsWith("dm:")) {
        return;
      }
      this.sendTo(obj.from, obj.command, { error: `Unknown command: ${obj.command}` }, obj.callback);
    } catch (error) {
      this.log.debug(`Could not answer the message: ${errText(error)}`);
    }
  }

  /**
   * Called if a subscribed object changes. A deleted client object revokes that client
   * (v1.19.0, audit 2026-09-25 H12; the state deletion usually arrives as well, revoking
   * twice is harmless). A light's device object that was added, changed or deleted makes
   * the bridge serve the new list (audit R-24) — its datapoints below do not.
   *
   * @param id - Full object ID
   * @param obj - The object, or null/undefined when it was deleted
   */
  private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
    try {
      const clientPrefix = `${this.namespace}.clients.`;
      if (!obj && id.startsWith(clientPrefix)) {
        this.apiHandler?.forgetClient(id.slice(clientPrefix.length));
      } else if (this.lights?.ids.numberOf(id) !== undefined) {
        this.scheduleLightReload();
      }
    } catch (error) {
      this.log.error(`Error handling object change for ${id}: ${errText(error)}`);
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
        // v1.19.0 (audit 2026-09-25 H12): a deleted client object revokes that client
        // at once — its key used to stay valid until the next start.
        const clientPrefix = `${this.namespace}.clients.`;
        if (id.startsWith(clientPrefix)) {
          this.apiHandler?.forgetClient(id.slice(clientPrefix.length));
          return;
        }
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
      this.apiHandler?.onStateChange(id, state.val, state.from);

      // Only handle non-acked state changes for our own states
      if (state.ack) {
        return;
      }

      if (id === `${this.namespace}.startPairing`) {
        this.handleStartPairing(state);
      } else if (id === `${this.namespace}.disableAuth`) {
        this.disableAuth = coerceBool(state.val);
      }
      // Every other own datapoint is write:false — a write to it without ack is not
      // the adapter's to confirm (js-controller 7.2.2 validator.ts warns about it).
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
      const seconds = HueEmu.PAIRING_TIMEOUT_MS / 1000;
      this.log.debug(`Pairing mode enabled — waiting for client to connect (${seconds} seconds)`);
      this.pairingTimeoutId = this.setTimeout(() => {
        this.pairingEnabled = false;
        this.log.debug(`Pairing mode automatically disabled after ${seconds} seconds timeout`);
      }, HueEmu.PAIRING_TIMEOUT_MS);
    } else {
      this.log.debug(`Pairing mode disabled`);
    }
  }

  /**
   * Migrate legacy devices (created via createLight JSON) into light objects. Thin
   * wrapper over the pure {@link runLegacyDeviceMigration} helper (extracted to
   * `lib/migrations.ts` for direct unit-testing, like the other migrations).
   *
   * @param lights the light store the converted lights go to
   * @param lightsStored whether any light object exists — then nothing is migrated
   * @returns true if lights were converted
   */
  private async migrateLegacyDevices(lights: LightStore, lightsStored: boolean): Promise<boolean> {
    return runLegacyDeviceMigration({
      namespace: this.namespace,
      lightsStored,
      getDevicesAsync: () => this.getDevicesAsync(),
      getStateAsync: id => this.getStateAsync(id),
      getObjectAsync: id => this.getObjectAsync(id),
      getStatesOfAsync: (device, channel) => this.getStatesOfAsync(device, channel),
      addLights: configs => lights.add(configs),
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
  // Export the constructor in compact mode; the class rides along on the factory for the tests (an `export` next
  // to `module.exports` makes esbuild treat the file as an ES module and warn — commonjs-variable-in-esm)
  module.exports = Object.assign((options: Partial<utils.AdapterOptions> | undefined) => new HueEmu(options), {
    HueEmu,
  });
} else {
  // Start the instance directly
  (() => new HueEmu())();
}
