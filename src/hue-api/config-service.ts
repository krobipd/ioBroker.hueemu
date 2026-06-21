/**
 * Configuration Service for Hue API
 */

import { BRIDGE_MODEL_ID, type BridgeIdentity } from "../types/config";
import type { BridgeConfigPublic, BridgeConfigFull, FullState } from "../types/hue-api";
import type { LightsCollection } from "../types/light";

/** Match a dotted-quad IPv4 address. */
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * Config service configuration
 */
export interface ConfigServiceConfig {
  /** Bridge identity */
  identity: BridgeIdentity;
  /** Advertised host (concrete IP shown to clients in the bridge config) */
  advertiseHost: string;
  /**
   * v1.4.3 (C6): paired client ids — used to populate the `whitelist` field
   * so spec-conformant Hue clients see who's currently paired. Synchronous
   * on purpose: keeps the rendering path non-async so callers (and the
   * mocha+ts-node loader, which trips on cross-cutting async chains) stay
   * simple. Caller can return whatever's cached at the moment.
   */
  whitelistProvider?: () => readonly string[];
}

/**
 * Service for providing Hue bridge configuration
 */
export class ConfigService {
  private readonly identity: BridgeIdentity;
  private readonly advertiseHost: string;
  private readonly whitelistProvider?: () => readonly string[];

  // Bridge configuration constants
  private static readonly SW_VERSION = "1941132080";
  private static readonly API_VERSION = "1.41.0";
  private static readonly DATASTORE_VERSION = "98";
  private static readonly MODEL_ID = BRIDGE_MODEL_ID;
  private static readonly BRIDGE_NAME = "Philips hue";

  /**
   * Create a new config service
   *
   * @param config - Config service configuration
   */
  constructor(config: ConfigServiceConfig) {
    this.identity = config.identity;
    this.advertiseHost = config.advertiseHost;
    this.whitelistProvider = config.whitelistProvider;
  }

  /** v1.4.3 (C2): IANA timezone of the host (or UTC if unresolvable). */
  private static getHostTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }

  /**
   * v1.8.1: per-timezone formatter cache. `getFullConfig` runs on every
   * `/api/{user}` call (Echo polls every few seconds) and previously built
   * 2-3 fresh `Intl.DateTimeFormat` instances per call — formatter
   * construction is the expensive part, formatting is cheap. Only ever
   * holds the host timezone + "UTC".
   */
  private static readonly formatterCache = new Map<string, Intl.DateTimeFormat>();

  /**
   * v1.4.3 (C3): Hue spec timestamp shape `YYYY-MM-DD HH:MM:SS` in `timezone`.
   *
   * @param date - Date to format
   * @param timezone - IANA timezone string
   */
  private static formatHueTimestamp(date: Date, timezone: string): string {
    try {
      let fmt = ConfigService.formatterCache.get(timezone);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        ConfigService.formatterCache.set(timezone, fmt);
      }
      return fmt.format(date).replace(", ", " ").replace(",", " ");
    } catch {
      return date.toISOString().replace("T", " ").substring(0, 19);
    }
  }

  /**
   * Get public bridge configuration (no auth required)
   */
  public getConfig(): BridgeConfigPublic {
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
   * Get full bridge configuration (requires auth).
   *
   * v1.4.3 (C1): IPv4-only gateway munge — old `replace(/\.\d+$/, ".1")`
   * produced garbage on IPv6 hosts.
   * v1.4.3 (C2+C3): real timezone + locally-shifted localtime.
   * v1.4.3 (C6): expose paired clients in `whitelist` for spec compliance.
   */
  public getFullConfig(): BridgeConfigFull {
    const tz = ConfigService.getHostTimezone();
    const now = new Date();
    const isIPv4 = IPV4_RE.test(this.advertiseHost);
    const gateway = isIPv4 ? this.advertiseHost.replace(/\.\d+$/, ".1") : this.advertiseHost;
    const whitelist: Record<string, { name: string; "create date": string; "last use date": string }> = {};
    if (this.whitelistProvider) {
      try {
        const ids = this.whitelistProvider();
        const ts = ConfigService.formatHueTimestamp(now, "UTC");
        for (const id of ids) {
          whitelist[id] = { name: id, "create date": ts, "last use date": ts };
        }
      } catch {
        /* whitelist remains empty — non-fatal */
      }
    }
    return {
      ...this.getConfig(),
      ipaddress: this.advertiseHost,
      netmask: "255.255.255.0",
      gateway,
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
      UTC: ConfigService.formatHueTimestamp(now, "UTC"),
      localtime: ConfigService.formatHueTimestamp(now, tz),
      timezone: tz,
      whitelist,
    };
  }

  /**
   * Build full state response
   *
   * @param lights - Collection of lights to include in the state
   */
  public buildFullState(lights: LightsCollection): FullState {
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
