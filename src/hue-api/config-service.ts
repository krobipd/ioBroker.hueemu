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
   * so spec-conformant Hue clients see who's currently paired. Synchronous on
   * purpose: keeps the rendering path non-async, so the caller can return
   * whatever's cached at the moment without the config build going async.
   */
  whitelistProvider?: () => readonly WhitelistClient[];
}

/** One paired client as the whitelist renders it (times in ms since the epoch). */
export interface WhitelistClient {
  /** The key the client authenticates with. */
  key: string;
  /** The device type it paired with. */
  name: string;
  /** When it paired. */
  created: number;
  /** When it was last seen. */
  lastUse: number;
}

/**
 * Service for providing Hue bridge configuration
 */
export class ConfigService {
  private readonly identity: BridgeIdentity;
  private readonly advertiseHost: string;
  private readonly whitelistProvider?: () => readonly WhitelistClient[];

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

  /**
   * The host's IANA timezone, resolved once.
   *
   * v1.4.3 (C2) read it per request; v1.8.1 then cached the FORMATTERS below and
   * left this one uncached — so 29 of the 34 µs a `/api/<user>` config build
   * costs went into constructing an `Intl.DateTimeFormat` just to read a string
   * off it, more than assembling 25 colour lights (measured, audit 2026-09-06
   * F6). A host that really changes its timezone restarts the instance anyway.
   */
  private static hostTimezone: string | undefined;

  /** v1.4.3 (C2): IANA timezone of the host (or UTC if unresolvable). */
  private static getHostTimezone(): string {
    if (ConfigService.hostTimezone === undefined) {
      try {
        ConfigService.hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        ConfigService.hostTimezone = "UTC";
      }
    }
    return ConfigService.hostTimezone;
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
   * Hue timestamp `YYYY-MM-DDTHH:MM:SS` in `timezone` — the ISO form without zone
   * the bridge, diyHue and the Burgestrand reference all use. v1.19.0 (audit
   * 2026-09-25 H5): it used to carry a blank instead of the `T`, and openHAB's Hue
   * binding (Gson `yyyy-MM-dd'T'HH:mm:ss`) failed on /config and listed no light.
   * `hourCycle: "h23"` instead of `hour12: false`: the latter can render midnight
   * as "24" on some ICU versions (N9).
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
          hourCycle: "h23",
        });
        ConfigService.formatterCache.set(timezone, fmt);
      }
      const part: Record<string, string> = {};
      for (const { type, value } of fmt.formatToParts(date)) {
        part[type] = value;
      }
      return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}`;
    } catch {
      return date.toISOString().substring(0, 19);
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
    let whitelist: Record<string, { name: string; "create date": string; "last use date": string }> = {};
    if (this.whitelistProvider) {
      try {
        const clients = this.whitelistProvider();
        // Own keys only: a client paired as `__proto__` would otherwise replace the
        // prototype of a `{}` literal and vanish from the list (Q5).
        whitelist = Object.fromEntries(
          clients.map(c => [
            c.key,
            {
              name: c.name,
              "create date": ConfigService.formatHueTimestamp(new Date(c.created || now.getTime()), "UTC"),
              "last use date": ConfigService.formatHueTimestamp(new Date(c.lastUse || now.getTime()), "UTC"),
            },
          ]),
        );
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
      // I4: placeholder — the orchestrator (api-handler.getFullState → buildFullState)
      // overwrites this unconditionally with the live pairingEnabled flag, so the
      // value set here is never actually served.
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
