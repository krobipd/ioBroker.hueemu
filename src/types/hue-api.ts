/**
 * Hue API request/response types
 */

import type { Light, LightsCollection, LightStateUpdate, LightStateResult } from './light';

/**
 * User creation request
 */
export interface CreateUserRequest {
    devicetype: string;
    generateclientkey?: boolean;
    username?: string;
}

/**
 * User creation success response
 */
export interface CreateUserSuccessResponse {
    success: {
        username: string;
        clientkey?: string;
    };
}

/**
 * Bridge whitelist entry
 */
export interface WhitelistEntry {
    'last use date': string;
    'create date': string;
    name: string;
}

/**
 * Bridge configuration (public, no auth required)
 */
export interface BridgeConfigPublic {
    name: string;
    datastoreversion: string;
    swversion: string;
    apiversion: string;
    mac: string;
    bridgeid: string;
    factorynew: boolean;
    replacesbridgeid: string | null;
    modelid: string;
    starterkitid: string;
}

/**
 * Full bridge configuration (requires auth)
 */
export interface BridgeConfigFull extends BridgeConfigPublic {
    ipaddress?: string;
    netmask?: string;
    gateway?: string;
    dhcp?: boolean;
    portalservices?: boolean;
    portalconnection?: string;
    portalstate?: {
        signedon: boolean;
        incoming: boolean;
        outgoing: boolean;
        communication: string;
    };
    linkbutton?: boolean;
    touchlink?: boolean;
    zigbeechannel?: number;
    UTC?: string;
    localtime?: string;
    timezone?: string;
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
    lights: LightsCollection;
    groups: EmptyObject;
    config: BridgeConfigFull;
    schedules: EmptyObject;
    scenes: EmptyObject;
    rules: EmptyObject;
    sensors: EmptyObject;
    resourcelinks: EmptyObject;
}

/**
 * Incoming HTTP request information
 */
export interface HueRequest {
    method: string;
    url: string;
    params: Record<string, string>;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
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
    getConfig(req: HueRequest, username: string): Promise<BridgeConfigPublic>;

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
    setLightState(req: HueRequest, username: string, lightId: string, state: LightStateUpdate): Promise<LightStateResult[]>;

    /**
     * Fallback for unhandled routes
     */
    fallback(req: HueRequest): Promise<unknown>;

    /**
     * Check if user is authenticated
     */
    isUserAuthenticated(username: string): Promise<boolean>;

    /**
     * Check if pairing is enabled
     */
    isPairingEnabled(): boolean;

    /**
     * Check if auth is disabled
     */
    isAuthDisabled(): boolean;
}
