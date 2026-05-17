/**
 * Main API Handler - Orchestrates all Hue API services
 */

import type { Logger } from "../types/config";
import type { HueApiHandler, HueRequest, CreateUserRequest, FullState, BridgeConfigPublic } from "../types/hue-api";
import type { Light, LightsCollection, LightStateUpdate, LightStateResult } from "../types/light";
import { HueApiError } from "../types/errors";
import { errText } from "../types/utils";
import { UserService, type UserServiceAdapter } from "./user-service";
import { ConfigService, type ConfigServiceConfig } from "./config-service";
import { DeviceBindingService, type DeviceConfig, type DeviceBindingAdapter } from "./device-binding-service";

/**
 * Combined adapter interface for the API handler
 */
export interface ApiHandlerAdapter extends UserServiceAdapter, DeviceBindingAdapter {
  pairingEnabled: boolean;
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
  /** ioBroker system language for user-facing log strings */
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
   */
  public onStateChange(id: string, value: unknown): void {
    this.lightService.updateStateCache(id, value);
  }

  /**
   * Create a new user
   */
  public async createUser(req: HueRequest, body: CreateUserRequest): Promise<string> {
    // Sanitize devicetype at the boundary — routes already require string,
    // but belt-and-braces in case createUser is called from another path.
    const devicetype = typeof body.devicetype === "string" && body.devicetype.length > 0 ? body.devicetype : "unknown";

    this.logger.debug(`Pairing request: devicetype=${devicetype}, generateclientkey=${body.generateclientkey}`);

    if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
      throw HueApiError.linkButtonNotPressed("/api");
    }

    // Use provided username only if it's a non-empty string; otherwise generate
    const rawUsername = (req.body as Record<string, unknown> | undefined)?.username;
    const providedUsername = typeof rawUsername === "string" && rawUsername.length > 0 ? rawUsername : undefined;

    if (providedUsername) {
      this.logger.debug(`Using provided username: ${providedUsername}`);
    }

    const username = await this.userService.createUser(providedUsername, devicetype);
    this.logger.info(`Paired client "${devicetype}" as user ${username}`);

    // Disable pairing after successful user creation (like real Hue bridge — link button resets after use)
    this.adapter.pairingEnabled = false;

    return username;
  }

  /**
   * Get full bridge state
   */
  public async getFullState(_req: HueRequest, username: string): Promise<FullState> {
    this.logger.debug(`Get full state for user: ${username}`);

    const lights = await this.lightService.getAllLights();
    const state = this.configService.buildFullState(lights);
    state.config.linkbutton = this.adapter.pairingEnabled;
    return state;
  }

  /**
   * Get bridge configuration
   */
  public async getConfig(_req: HueRequest, _username: string): Promise<BridgeConfigPublic> {
    this.logger.debug("Get config");
    return this.configService.getConfig();
  }

  /**
   * Get all lights
   */
  public async getAllLights(_req: HueRequest, _username: string): Promise<LightsCollection> {
    this.logger.debug("Get all lights");
    return this.lightService.getAllLights();
  }

  /**
   * Get a single light by ID
   */
  public async getLightById(_req: HueRequest, _username: string, lightId: string): Promise<Light> {
    this.logger.debug(`Get light: ${lightId}`);
    return this.lightService.getLightById(lightId);
  }

  /**
   * Set light state
   */
  public async setLightState(
    _req: HueRequest,
    _username: string,
    lightId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]> {
    this.logger.debug(`Set light ${lightId} state: ${JSON.stringify(state)}`);
    return this.lightService.setLightState(lightId, state);
  }

  /**
   * Set group action — applies state to all configured lights
   */
  public async setGroupAction(
    _req: HueRequest,
    _username: string,
    groupId: string,
    state: LightStateUpdate,
  ): Promise<LightStateResult[]> {
    this.logger.debug(`Set group ${groupId} action: ${JSON.stringify(state)}`);

    const lights = await this.lightService.getAllLights();

    // Apply state to all lights in parallel
    await Promise.all(
      Object.keys(lights).map(lightId =>
        this.lightService.setLightState(lightId, state).catch((err: unknown) => {
          this.logger.warn(`Group action: failed to set light ${lightId}: ${errText(err)}`);
        }),
      ),
    );

    // Return group-addressed success response (Hue API format)
    return Object.entries(state).map(([key, value]) => ({
      success: { [`/groups/${groupId}/action/${key}`]: value },
    }));
  }

  /**
   * Fallback for unhandled routes
   */
  public async fallback(req: HueRequest): Promise<unknown> {
    this.logger.warn(`Unhandled request: ${req.method} ${req.url}`);
    return {};
  }

  /**
   * Check if user is authenticated
   */
  public async isUserAuthenticated(username: string): Promise<boolean> {
    // During pairing, auto-add unknown users (Amazon Echo compatibility)
    const isAuth = await this.userService.isUserAuthenticated(username);

    if (!isAuth && this.adapter.pairingEnabled) {
      // v1.4.3 (U1+R2): defense-in-depth cap inside addUser(viaAutoAdd=true)
      // — a hostile or chatty client can't fill the clients folder during
      // the 50 s window.
      try {
        await this.userService.addUser(username, "auto-paired", true);
        this.logger.debug(`Pairing enabled, auto-added user: ${username}`);
        return true;
      } catch (err) {
        this.logger.warn(`Auto-add rejected for ${username}: ${errText(err)}`);
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
   * Check if auth is disabled
   */
  public isAuthDisabled(): boolean {
    return this.adapter.disableAuth;
  }
}
