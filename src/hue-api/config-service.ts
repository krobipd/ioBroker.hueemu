/**
 * Configuration Service for Hue API
 */

import { BRIDGE_MODEL_ID, type BridgeIdentity } from "../types/config";
import type { BridgeConfigPublic, BridgeConfigFull, FullState } from "../types/hue-api";
import type { LightsCollection } from "../types/light";

/**
 * Config service configuration
 */
export interface ConfigServiceConfig {
  /** Bridge identity */
  identity: BridgeIdentity;
  /** Discovery host (IP address) */
  discoveryHost: string;
}

/**
 * Service for providing Hue bridge configuration
 */
export class ConfigService {
  private readonly identity: BridgeIdentity;
  private readonly discoveryHost: string;

  // Bridge configuration constants
  private static readonly SW_VERSION = "1941132080";
  private static readonly API_VERSION = "1.41.0";
  private static readonly DATASTORE_VERSION = "98";
  private static readonly MODEL_ID = BRIDGE_MODEL_ID;
  private static readonly BRIDGE_NAME = "Philips hue";

  constructor(config: ConfigServiceConfig) {
    this.identity = config.identity;
    this.discoveryHost = config.discoveryHost;
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
   * Get full bridge configuration (requires auth)
   */
  public getFullConfig(): BridgeConfigFull {
    return {
      ...this.getConfig(),
      ipaddress: this.discoveryHost,
      netmask: "255.255.255.0",
      gateway: this.discoveryHost.replace(/\.\d+$/, ".1"),
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
      UTC: new Date().toISOString().replace("T", " ").substring(0, 19),
      localtime: new Date().toISOString().replace("T", " ").substring(0, 19),
      timezone: "Europe/Berlin",
      whitelist: {},
    };
  }

  /**
   * Build full state response
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
