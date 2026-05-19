/**
 * Hue API request/response types
 */

import type { Light, LightsCollection, LightStateUpdate, LightStateResult } from "./light";

/**
 * User creation request
 */
export interface CreateUserRequest {
  /** Device type identifier from the client */
  devicetype: string;
  /** Whether to generate a client key */
  generateclientkey?: boolean;
  /** Optional pre-defined username */
  username?: string;
}

/**
 * Bridge whitelist entry
 */
export interface WhitelistEntry {
  /** Timestamp of last API usage */
  "last use date": string;
  /** Timestamp when the entry was created */
  "create date": string;
  /** Client display name */
  name: string;
}

/**
 * Bridge configuration (public, no auth required)
 */
export interface BridgeConfigPublic {
  /** Bridge display name */
  name: string;
  /** Datastore version number */
  datastoreversion: string;
  /** Software version string */
  swversion: string;
  /** API version string */
  apiversion: string;
  /** MAC address of the bridge */
  mac: string;
  /** Unique bridge identifier */
  bridgeid: string;
  /** Whether the bridge is factory new */
  factorynew: boolean;
  /** ID of replaced bridge (null if none) */
  replacesbridgeid: string | null;
  /** Model identifier */
  modelid: string;
  /** Starter kit identifier */
  starterkitid: string;
}

/**
 * Full bridge configuration (requires auth)
 */
export interface BridgeConfigFull extends BridgeConfigPublic {
  /** IP address of the bridge */
  ipaddress?: string;
  /** Network mask */
  netmask?: string;
  /** Default gateway address */
  gateway?: string;
  /** Whether DHCP is enabled */
  dhcp?: boolean;
  /** Whether portal services are enabled */
  portalservices?: boolean;
  /** Portal connection status */
  portalconnection?: string;
  /** Portal state details */
  portalstate?: {
    /** Whether signed on to portal */
    signedon: boolean;
    /** Whether incoming connections are allowed */
    incoming: boolean;
    /** Whether outgoing connections are allowed */
    outgoing: boolean;
    /** Communication status */
    communication: string;
  };
  /** Whether link button is pressed */
  linkbutton?: boolean;
  /** Whether touchlink is active */
  touchlink?: boolean;
  /** Zigbee channel number */
  zigbeechannel?: number;
  /** Current UTC time */
  UTC?: string;
  /** Current local time */
  localtime?: string;
  /** IANA timezone string */
  timezone?: string;
  /** Paired clients whitelist */
  whitelist?: Record<string, WhitelistEntry>;
}

/**
 * Empty object placeholder for unsupported features
 */
export type EmptyObject = Record<string, never>;

/**
 * Full state response (GET /api/:username)
 */
export interface FullState {
  /** All registered lights */
  lights: LightsCollection;
  /** Groups (empty, not implemented) */
  groups: EmptyObject;
  /** Full bridge configuration */
  config: BridgeConfigFull;
  /** Schedules (empty, not implemented) */
  schedules: EmptyObject;
  /** Scenes (empty, not implemented) */
  scenes: EmptyObject;
  /** Rules (empty, not implemented) */
  rules: EmptyObject;
  /** Sensors (empty, not implemented) */
  sensors: EmptyObject;
  /** Resource links (empty, not implemented) */
  resourcelinks: EmptyObject;
}

/**
 * Incoming HTTP request information
 */
export interface HueRequest {
  /** HTTP method (GET, POST, PUT, etc.) */
  method: string;
  /** Request URL path */
  url: string;
  /** URL path parameters */
  params: Record<string, string>;
  /** Request body */
  body: unknown;
  /** HTTP headers */
  headers: Record<string, string | string[] | undefined>;
  /** Client IP address */
  ip?: string;
}

/**
 * API handler interface that must be implemented
 */
export interface HueApiHandler {
  /**
   * Create a new user (POST /api)
   */
  createUser(req: HueRequest, body: CreateUserRequest): Promise<string>;

  /**
   * Get full bridge state (GET /api/:username)
   */
  getFullState(req: HueRequest, username: string): Promise<FullState>;

  /**
   * Get bridge configuration (GET /api/:username/config)
   */
  getConfig(req: HueRequest, username: string): BridgeConfigPublic;

  /**
   * Get all lights (GET /api/:username/lights)
   */
  getAllLights(req: HueRequest, username: string): Promise<LightsCollection>;

  /**
   * Get single light (GET /api/:username/lights/:id)
   */
  getLightById(req: HueRequest, username: string, lightId: string): Promise<Light>;

  /**
   * Set light state (PUT /api/:username/lights/:id/state)
   */
  setLightState(
    req: HueRequest,
    username: string,
    lightId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]>;

  /**
   * Set group action (PUT /api/:username/groups/:id/action)
   */
  setGroupAction(
    req: HueRequest,
    username: string,
    groupId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]>;

  /**
   * Fallback for unhandled routes
   */
  fallback(req: HueRequest): unknown;

  /**
   * Check if user is authenticated
   */
  isUserAuthenticated(username: string): Promise<boolean>;

  /**
   * Check if auth is disabled
   */
  isAuthDisabled(): boolean;
}
