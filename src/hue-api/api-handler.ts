/**
 * Main API Handler - Orchestrates all Hue API services
 */

import type { Logger } from "../types/config";
import type {
  HueApiHandler,
  HueRequest,
  CreateUserRequest,
  FullState,
  BridgeConfigPublic,
  BridgeConfigFull,
} from "../types/hue-api";
import type { Light, LightsCollection, LightStateUpdate, LightStateResult } from "../types/light";
import { HueApiError } from "../types/errors";
import { errText, oneLine } from "../types/utils";
import { MAX_DEVICETYPE_LENGTH, MAX_USERNAME_LENGTH, UserService, type UserServiceAdapter } from "./user-service";
import { ConfigService, type ConfigServiceConfig } from "./config-service";
import { DeviceBindingService, type DeviceConfig, type DeviceBindingAdapter } from "./device-binding-service";

// Hue light-state attributes a group action may legitimately set. The success
// echo is built from these known keys instead of reflecting arbitrary body keys
// straight back to the client.
const GROUP_ACTION_KEYS = new Set([
  "on",
  "bri",
  "hue",
  "sat",
  "ct",
  "xy",
  "transitiontime",
  "bri_inc",
  "sat_inc",
  "hue_inc",
  "ct_inc",
  "xy_inc",
  "effect",
  "alert",
  "colormode",
]);

/**
 * Combined adapter interface for the API handler
 */
export interface ApiHandlerAdapter extends UserServiceAdapter, DeviceBindingAdapter {
  /** Whether pairing mode is currently active */
  pairingEnabled: boolean;
  /** Whether authentication is disabled */
  disableAuth: boolean;
}

/**
 * API handler configuration
 */
export interface ApiHandlerConfig {
  /** Adapter instance */
  adapter: ApiHandlerAdapter;
  /** Config service configuration */
  configServiceConfig: ConfigServiceConfig;
  /** Device configurations from admin UI */
  devices?: DeviceConfig[];
  /** Logger */
  logger: Logger;
}

/**
 * Main API Handler implementation
 * Implements the HueApiHandler interface and orchestrates all services
 */
export class ApiHandler implements HueApiHandler {
  private readonly adapter: ApiHandlerAdapter;
  private readonly userService: UserService;
  private readonly lightService: DeviceBindingService;
  private readonly configService: ConfigService;
  private readonly logger: Logger;
  /**
   * Create a new API handler and initialize all services
   *
   * @param config - API handler configuration
   */
  constructor(config: ApiHandlerConfig) {
    this.adapter = config.adapter;
    this.logger = config.logger;
    // Initialize user service
    this.userService = new UserService({
      adapter: config.adapter,
      logger: config.logger,
    });

    // Initialize config service. Wire a sync whitelistProvider to the
    // user-service cache so /api/{user} responses expose paired clients
    // per Hue spec (C6) without forcing the render path async.
    this.configService = new ConfigService({
      ...config.configServiceConfig,
      whitelistProvider: () => this.userService.listCachedClientIds(),
    });

    // Initialize device binding service
    const devices = config.devices || [];
    this.lightService = new DeviceBindingService({
      adapter: config.adapter,
      devices,
      logger: config.logger,
    });
    this.logger.debug(`${devices.length} device(s) configured`);
  }

  /**
   * Initialize the API handler (must be called after construction)
   */
  public async initialize(): Promise<void> {
    await this.lightService.initialize();
  }

  /**
   * Update state cache when a foreign state changes
   *
   * @param id - Full state ID that changed
   * @param value - New state value
   */
  public onStateChange(id: string, value: unknown): void {
    this.lightService.updateStateCache(id, value);
  }

  /**
   * Create a new user
   *
   * @param _req - Incoming HTTP request (unused; username now read from the typed body)
   * @param body - User creation request body
   */
  public async createUser(_req: HueRequest, body: CreateUserRequest): Promise<string> {
    // Sanitize devicetype at the boundary — routes already require string,
    // but belt-and-braces in case createUser is called from another path.
    const rawDevicetype =
      typeof body.devicetype === "string" && body.devicetype.length > 0 ? body.devicetype : "unknown";
    // Client-supplied and stored as the client object's display name — cap it
    // (the body limit alone still allows 64 KiB here).
    const devicetype = rawDevicetype.slice(0, MAX_DEVICETYPE_LENGTH);

    this.logger.debug(
      `Pairing request: devicetype=${oneLine(devicetype)}, generateclientkey=${oneLine(String(body.generateclientkey))}`,
    );

    if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
      throw HueApiError.linkButtonNotPressed("/api");
    }

    // Use provided username only if it's a non-empty string; otherwise generate.
    // body === req.body in every route path (api-v1-routes.ts), and
    // CreateUserRequest.username is already typed string | undefined.
    const rawUsername = body.username;
    // A provided username becomes a persistent object id, so it is capped like a
    // real bridge caps its own (40 chars): anything longer is ignored and a
    // generated id is returned — clients read the id from the response anyway.
    const providedUsername =
      typeof rawUsername === "string" && rawUsername.length > 0 && rawUsername.length <= MAX_USERNAME_LENGTH
        ? rawUsername
        : undefined;

    if (providedUsername) {
      this.logger.debug(`Using provided username: ${oneLine(providedUsername)}`);
    } else if (typeof rawUsername === "string" && rawUsername.length > MAX_USERNAME_LENGTH) {
      this.logger.debug(
        `Ignoring provided username (${rawUsername.length} chars, max ${MAX_USERNAME_LENGTH}) — generating one`,
      );
    }

    let username: string;
    try {
      username = await this.userService.createUser(providedUsername, devicetype);
    } catch (err) {
      // The only throw left in the create path is the hourly ceiling on new
      // clients (UserService warns once per window) — answer like a bridge whose
      // link button is not pressed, so the client simply retries later.
      this.logger.debug(`Pairing rejected for "${oneLine(devicetype)}": ${errText(err)}`);
      throw HueApiError.linkButtonNotPressed("/api");
    }
    this.logger.info(`Paired client "${oneLine(devicetype)}" as user ${oneLine(username)}`);

    // Disable pairing after successful user creation (like real Hue bridge — link button resets after use)
    this.adapter.pairingEnabled = false;

    return username;
  }

  /**
   * Get full bridge state
   *
   * @param _req - Incoming HTTP request (unused)
   * @param username - Authenticated username
   */
  public async getFullState(_req: HueRequest, username: string): Promise<FullState> {
    this.logger.debug(`Get full state for user: ${oneLine(username)}`);

    const lights = await this.lightService.getAllLights();
    const state = this.configService.buildFullState(lights);
    state.config.linkbutton = this.adapter.pairingEnabled;
    return state;
  }

  /**
   * Get bridge configuration
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   */
  public getConfig(_req: HueRequest, _username: string): BridgeConfigPublic {
    this.logger.debug("Get config");
    return this.configService.getConfig();
  }

  /**
   * Get the full bridge configuration for an authenticated user. Mirrors the
   * live pairing state into `linkbutton`, exactly like the full-state response.
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   */
  public getFullConfig(_req: HueRequest, _username: string): BridgeConfigFull {
    this.logger.debug("Get full config");
    const config = this.configService.getFullConfig();
    config.linkbutton = this.adapter.pairingEnabled;
    return config;
  }

  /**
   * Get all lights
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   */
  public async getAllLights(_req: HueRequest, _username: string): Promise<LightsCollection> {
    this.logger.debug("Get all lights");
    return this.lightService.getAllLights();
  }

  /**
   * Get a single light by ID
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   * @param lightId - Light identifier
   */
  public async getLightById(_req: HueRequest, _username: string, lightId: string): Promise<Light> {
    this.logger.debug(`Get light: ${oneLine(lightId)}`);
    return this.lightService.getLightById(lightId);
  }

  /**
   * Set light state
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   * @param lightId - Light identifier
   * @param state - State update to apply
   */
  public async setLightState(
    _req: HueRequest,
    _username: string,
    lightId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]> {
    this.logger.debug(`Set light ${oneLine(lightId)} state: ${JSON.stringify(state)}`);
    return this.lightService.setLightState(lightId, state);
  }

  /**
   * Set group action — applies state to all configured lights
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   * @param groupId - Group identifier
   * @param state - State update to apply to all lights
   */
  public async setGroupAction(
    _req: HueRequest,
    _username: string,
    groupId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]> {
    this.logger.debug(`Set group ${oneLine(groupId)} action: ${JSON.stringify(state)}`);

    // Fan out to every configured light using the cheap id list, not
    // getAllLights() (which rebuilds every light's full state) — a flood of
    // group writes shouldn't multiply state reads on top of the writes.
    const lightIds = this.lightService.getLightIds();
    await Promise.all(
      lightIds.map(lightId =>
        this.lightService.setLightState(lightId, state).catch((err: unknown) => {
          this.logger.warn(`Group action: failed to set light ${lightId}: ${errText(err)}`);
        }),
      ),
    );

    // Return a group-addressed success response (Hue API format) built only
    // from known light-state attributes — don't reflect arbitrary body keys.
    return Object.entries(state)
      .filter(([key]) => GROUP_ACTION_KEYS.has(key))
      .map(([key, value]) => ({
        success: { [`/groups/${groupId}/action/${key}`]: value },
      }));
  }

  /**
   * Fallback for unhandled routes. Logged at debug: the route needs no
   * authentication, so a warning here would be a log line anyone on the LAN
   * can produce at will.
   *
   * @param req - Incoming HTTP request
   */
  public fallback(req: HueRequest): unknown {
    this.logger.debug(`Unhandled request: ${req.method} ${req.url}`);
    return {};
  }

  /**
   * Check if user is authenticated
   *
   * @param username - Username to check
   */
  public async isUserAuthenticated(username: string): Promise<boolean> {
    // During pairing, auto-add unknown users (Amazon Echo compatibility)
    const isAuth = await this.userService.isUserAuthenticated(username);

    if (!isAuth && this.adapter.pairingEnabled) {
      if (username.length > MAX_USERNAME_LENGTH) {
        // The name would become a persistent object id — a URL can carry
        // kilobytes here, so over-long names are never auto-paired.
        this.logger.debug(
          `Auto-add skipped for an over-long username (${username.length} chars, max ${MAX_USERNAME_LENGTH})`,
        );
        return false;
      }
      // v1.4.3 (U1+R2): defense-in-depth cap inside addUser(viaAutoAdd=true)
      // — a hostile or chatty client can't fill the clients folder during
      // the 50 s window.
      try {
        await this.userService.addUser(username, "auto-paired", true);
        this.logger.debug(`Pairing enabled, auto-added user: ${oneLine(username)}`);
        return true;
      } catch (err) {
        // Debug, not warn: this route needs no authentication, so a warning here
        // is a log line anyone on the LAN can produce at will during the pairing
        // window — the same reasoning `fallback` below already follows. The
        // budget that was actually hit warns once per window in UserService.
        this.logger.debug(`Auto-add rejected for ${oneLine(username)}: ${errText(err)}`);
        return false;
      }
    }

    return isAuth;
  }

  /** Reset the per-pairing-window auto-add budget (called on pairing-on). */
  public resetAutoAddBudget(): void {
    this.userService.resetAutoAddBudget();
  }

  /**
   * Pure paired-client lookup — no auto-add. For routes a client may poll
   * before it is paired (/config), where the auto-add would turn a probe name
   * like "nouser" into a valid key.
   *
   * @param username - Username to look up
   */
  public async isKnownUser(username: string): Promise<boolean> {
    return this.userService.isUserAuthenticated(username);
  }

  /**
   * Check if auth is disabled
   */
  public isAuthDisabled(): boolean {
    return this.adapter.disableAuth;
  }
}
