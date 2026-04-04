/**
 * ioBroker Hue Emulator Adapter
 * Emulates a Philips Hue Bridge for smart home integrations
 */

import * as utils from "@iobroker/adapter-core";
import * as uuid from "uuid";
import * as forge from "node-forge";

import { HueServer } from "./server";
import { HueSsdpServer } from "./discovery";
import { ApiHandler, type DeviceConfig } from "./hue-api";
import type {
  HueEmulatorConfig,
  BridgeIdentity,
  TlsConfig,
  Logger,
} from "./types/config";
import { generateBridgeId, generateSerialNumber } from "./types/config";

// Augment the adapter.config object with the actual types
declare global {
  namespace ioBroker {
    interface AdapterConfig {
      host: string;
      port: number;
      discoveryHost: string;
      discoveryPort: number;
      httpsPort: number | undefined;
      udn: string;
      mac: string;
      devices: DeviceConfig[];
      [key: string]: any;
    }
  }
}

/**
 * Hue Emulator Adapter
 */
export class HueEmu extends utils.Adapter {
  private pairingTimeoutId: ioBroker.Timeout | undefined = undefined;
  private _pairingEnabled = false;
  private _disableAuth = false;

  private hueServer: HueServer | null = null;
  private ssdpServer: HueSsdpServer | null = null;
  private apiHandler: ApiHandler | null = null;

  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "hueemu",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  get pairingEnabled(): boolean {
    return this._pairingEnabled;
  }

  /**
   *
   */
  set pairingEnabled(value: boolean) {
    this._pairingEnabled = value;
    if (!value && this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = undefined;
    }
    void this.setState("startPairing", { ack: true, val: value });
  }

  /**
   *
   */
  get disableAuth(): boolean {
    return this._disableAuth;
  }

  /**
   *
   */
  set disableAuth(value: boolean) {
    this._disableAuth = value;
    void this.setState("disableAuth", { ack: true, val: value });
    this.log.info(
      `Authentication ${value ? "disabled (all requests allowed)" : "enabled"}`,
    );
  }

  /**
   * Called when databases are connected and adapter received configuration
   */
  private async onReady(): Promise<void> {
    try {
      // Migrate legacy devices (created via createLight) to admin config format
      const migrated = await this.migrateLegacyDevices();
      if (migrated) {
        // Config was updated — adapter will restart automatically
        return;
      }

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

      // Create API handler with device configurations
      this.apiHandler = new ApiHandler({
        adapter: this as any,
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

      // Start servers
      await this.ssdpServer.start();
      await this.hueServer.start();

      // Initialize adapter states
      await this.initializeAdapterStates();

      // Remove obsolete states from previous versions
      await this.cleanupObsoleteStates();

      // Subscribe to state changes (own states)
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
  private async buildConfig(): Promise<HueEmulatorConfig> {
    // Parse configuration values
    const host = this.config.host?.trim() || "";
    const port = this.toPort(this.config.port);
    const discoveryHost = this.config.discoveryHost?.trim() || host;
    const discoveryPort = this.toPort(this.config.discoveryPort) || port;
    const httpsPort = this.toUndefinedPort(this.config.httpsPort);
    const udn = this.config.udn?.trim() || uuid.v4();
    const mac = this.config.mac?.trim() || this.macFromUdn(udn);

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
      modelId: "BSB002",
      serialNumber: generateSerialNumber(mac),
    };

    // Build TLS config if HTTPS is enabled
    let https: TlsConfig | undefined;
    if (httpsPort) {
      const cert = await this.generateCertificate();
      https = {
        port: httpsPort,
        cert: cert.certificate,
        key: cert.privateKey,
      };
    }

    this.log.debug(
      `Bridge identity: bridgeId=${identity.bridgeId}, MAC=${identity.mac}, serial=${identity.serialNumber}`,
    );
    this.log.debug(
      `Network: HTTP=${host}:${port}, SSDP=:${upnpPort}${httpsPort ? `, HTTPS=:${httpsPort}` : ""}`,
    );
    this.log.debug(`UDN: ${identity.udn}`);

    return {
      host,
      port,
      discoveryHost,
      discoveryPort,
      https,
      upnpPort,
      identity,
    };
  }

  /**
   * Generate a self-signed certificate for HTTPS
   */
  private async generateCertificate(): Promise<{
    certificate: string;
    privateKey: string;
  }> {
    this.log.info("Generating self-signed certificate for HTTPS");

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 10,
    );

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
   * Initialize adapter states
   */
  private async initializeAdapterStates(): Promise<void> {
    // Create startPairing state
    await this.setObjectNotExistsAsync("startPairing", {
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
    await this.setObjectNotExistsAsync("disableAuth", {
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
    const disableAuthState = await this.getStateAsync("disableAuth");
    this._disableAuth = (disableAuthState?.val as boolean) || false;
  }

  /**
   * Remove states/channels/objects that were removed in newer adapter versions
   */
  private async cleanupObsoleteStates(): Promise<void> {
    const obsoleteStates = [
      "info.configuredDevices", // removed in 1.0.15
      "createLight", // removed in 1.1.0 (legacy mode replaced by admin config + migration)
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
  private createLogger(): Logger {
    return {
      silly: (msg: string) => this.log.silly(msg),
      debug: (msg: string) => this.log.debug(msg),
      info: (msg: string) => this.log.info(msg),
      warn: (msg: string) => this.log.warn(msg),
      error: (msg: string) => this.log.error(msg),
    };
  }

  /**
   * Called when adapter shuts down
   */
  private onUnload(callback: () => void): void {
    try {
      // Clear pairing timeout
      if (this.pairingTimeoutId) {
        this.clearTimeout(this.pairingTimeoutId);
        this.pairingTimeoutId = undefined;
      }

      // Stop SSDP server
      if (this.ssdpServer) {
        this.ssdpServer.stop();
      }

      // Stop HTTP server (fire-and-forget — onUnload must be sync)
      if (this.hueServer) {
        this.hueServer
          .stop()
          .catch((err: Error) =>
            this.log.error(`Server stop error: ${err.message}`),
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
  private onStateChange(
    id: string,
    state: ioBroker.State | null | undefined,
  ): void {
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
      this.disableAuth = state.val as boolean;
    } else if (id.startsWith(this.namespace)) {
      // Acknowledge other own state changes
      void this.setState(id, { ack: true, val: state.val });
    }
  }

  /**
   * Handle startPairing state change
   */
  private handleStartPairing(state: ioBroker.State): void {
    if (this.pairingTimeoutId) {
      this.clearTimeout(this.pairingTimeoutId);
      this.pairingTimeoutId = undefined;
    }

    this.pairingEnabled = state.val as boolean;

    if (state.val) {
      this.log.info(
        "Pairing mode enabled — waiting for client to connect (50 seconds)",
      );
      this.pairingTimeoutId = this.setTimeout(() => {
        this._pairingEnabled = false;
        void this.setState("startPairing", { ack: true, val: false });
        this.log.info(
          "Pairing mode automatically disabled after 50 seconds timeout",
        );
      }, 50000);
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

    this.log.info(
      `Found ${devices.length} legacy device(s) — migrating to new configuration`,
    );

    const migratedDevices: DeviceConfig[] = [];

    for (const device of devices) {
      const deviceId = device._id.substring(this.namespace.length + 1);

      try {
        // Read device name from name state or device common.name
        const nameState = await this.getStateAsync(`${deviceId}.name`);
        const name =
          (nameState?.val as string) ||
          (device.common?.name as string) ||
          deviceId;

        // Read state channel to find available state keys
        const stateObjects = await this.getStatesOfAsync(deviceId, "state");
        const stateKeys = new Set(
          (stateObjects || []).map((s) =>
            s._id.substring(s._id.lastIndexOf(".") + 1),
          ),
        );

        // Determine light type from available states
        let lightType: "onoff" | "dimmable" | "ct" | "color";
        if (
          stateKeys.has("hue") ||
          stateKeys.has("sat") ||
          stateKeys.has("xy")
        ) {
          lightType = "color";
        } else if (stateKeys.has("ct")) {
          lightType = "ct";
        } else if (stateKeys.has("bri")) {
          lightType = "dimmable";
        } else {
          lightType = "onoff";
        }

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

        // Clean up legacy-only wrapper objects (keep state.* objects for DeviceBindingService)
        await this.delObjectAsync(`${deviceId}.name`).catch(() => {});
        await this.delObjectAsync(`${deviceId}.data`).catch(() => {});
        await this.delObjectAsync(`${deviceId}.state`).catch(() => {}); // channel only
        await this.delObjectAsync(deviceId).catch(() => {}); // device wrapper
      } catch (error) {
        this.log.warn(`Could not migrate legacy device ${deviceId}: ${error}`);
      }
    }

    if (migratedDevices.length === 0) {
      return false;
    }

    // Save migrated devices to adapter config (triggers automatic restart)
    await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
      native: { devices: migratedDevices },
    });

    this.log.info(
      `Migration complete: ${migratedDevices.length} device(s) converted. Adapter will restart.`,
    );

    return true;
  }

  /**
   * Parse port number
   */
  private toPort(port: any): number {
    if (port) {
      return typeof port === "number"
        ? port
        : parseInt(port.toString().trim(), 10);
    }
    throw new Error("Port not specified");
  }

  /**
   * Parse optional port
   */
  private toUndefinedPort(port: any): number | undefined {
    if (port) {
      return typeof port === "number" ? port : parseInt(port.toString(), 10);
    }
    return undefined;
  }

  /**
   * Derive a stable MAC address from the UDN (used when no MAC is configured)
   */
  private macFromUdn(udn: string): string {
    const hex = udn.replace(/-/g, "").slice(0, 12).padEnd(12, "0");
    return hex.match(/.{2}/g)!.join(":");
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) =>
    new HueEmu(options);
} else {
  // Start the instance directly
  (() => new HueEmu())();
}
