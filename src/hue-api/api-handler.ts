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
} from "../types/hue-api";
import type {
  Light,
  LightsCollection,
  LightStateUpdate,
  LightStateResult,
} from "../types/light";
import { HueApiError } from "../types/errors";
import { UserService, type UserServiceAdapter } from "./user-service";
import { LightService, type LightServiceAdapter } from "./light-service";
import { ConfigService, type ConfigServiceConfig } from "./config-service";
import {
  DeviceBindingService,
  type DeviceConfig,
  type DeviceBindingAdapter,
} from "./device-binding-service";

/**
 * Combined adapter interface for the API handler
 */
export interface ApiHandlerAdapter
  extends UserServiceAdapter, LightServiceAdapter, DeviceBindingAdapter {
  pairingEnabled: boolean;
  /**
   *
   */
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
  /** Optional logger */
  logger?: Logger;
}

/**
 * Light service interface (common between LightService and DeviceBindingService)
 */
interface LightServiceInterface {
  getAllLights(): Promise<LightsCollection>;
  getLightById(lightId: string): Promise<Light>;
  setLightState(
    lightId: string,
    stateUpdate: LightStateUpdate,
  ): Promise<LightStateResult[]>;
}

/**
 * Main API Handler implementation
 * Implements the HueApiHandler interface and orchestrates all services
 */
export class ApiHandler implements HueApiHandler {
  private readonly adapter: ApiHandlerAdapter;
  private readonly userService: UserService;
  private readonly lightService: LightServiceInterface;
  private readonly configService: ConfigService;
  private readonly deviceBindingService?: DeviceBindingService;
  private readonly logger?: Logger;
  private readonly useDeviceBinding: boolean;

  /**
   *
   */
  constructor(config: ApiHandlerConfig) {
    this.adapter = config.adapter;
    this.logger = config.logger;

    // Initialize user service
    this.userService = new UserService({
      adapter: config.adapter,
      logger: config.logger,
    });

    // Initialize config service
    this.configService = new ConfigService(config.configServiceConfig);

    // Determine which light service to use
    const devices = config.devices || [];
    this.useDeviceBinding = devices.length > 0;

    if (this.useDeviceBinding) {
      // Use DeviceBindingService for admin-configured devices
      this.deviceBindingService = new DeviceBindingService({
        adapter: config.adapter,
        devices,
        logger: config.logger,
      });
      this.lightService = this.deviceBindingService;
      this.log(
        "info",
        `Using DeviceBindingService with ${devices.length} configured devices`,
      );
    } else {
      // Fall back to legacy LightService for manually created devices
      this.lightService = new LightService({
        adapter: config.adapter,
        logger: config.logger,
      });
      this.log(
        "info",
        "Using legacy LightService (no devices configured in admin)",
      );
    }
  }

  /**
   * Initialize the API handler (must be called after construction)
   */
  public async initialize(): Promise<void> {
    if (this.deviceBindingService) {
      await this.deviceBindingService.initialize();
    }
  }

  /**
   * Update state cache when a foreign state changes
   */
  public onStateChange(id: string, value: unknown): void {
    if (this.deviceBindingService) {
      this.deviceBindingService.updateStateCache(id, value);
    }
  }

  /**
   * Create a new user
   */
  public async createUser(
    req: HueRequest,
    body: CreateUserRequest,
  ): Promise<string> {
    this.log(
      "info",
      `Pairing request: devicetype=${body.devicetype}, generateclientkey=${body.generateclientkey}`,
    );

    if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
      throw HueApiError.linkButtonNotPressed("/api");
    }

    // Use provided username or generate new one
    const providedUsername = (req.body as Record<string, unknown>)?.username as
      | string
      | undefined;

    if (providedUsername) {
      this.log("info", `Using provided username: ${providedUsername}`);
    }

    const username = await this.userService.createUser(
      providedUsername,
      body.devicetype,
    );
    this.log("info", `Created user: ${username}`);

    return username;
  }

  /**
   * Get full bridge state
   */
  public async getFullState(
    _req: HueRequest,
    username: string,
  ): Promise<FullState> {
    this.log("debug", `Get full state for user: ${username}`);

    const lights = await this.lightService.getAllLights();
    const state = this.configService.buildFullState(lights);
    state.config.linkbutton = this.adapter.pairingEnabled;
    return state;
  }

  /**
   * Get bridge configuration
   */
  public async getConfig(
    _req: HueRequest,
    _username: string,
  ): Promise<BridgeConfigPublic> {
    this.log("debug", "Get config");
    return this.configService.getConfig();
  }

  /**
   * Get all lights
   */
  public async getAllLights(
    _req: HueRequest,
    _username: string,
  ): Promise<LightsCollection> {
    this.log("debug", "Get all lights");
    return this.lightService.getAllLights();
  }

  /**
   * Get a single light by ID
   */
  public async getLightById(
    _req: HueRequest,
    _username: string,
    lightId: string,
  ): Promise<Light> {
    this.log("debug", `Get light: ${lightId}`);
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
    this.log("debug", `Set light ${lightId} state: ${JSON.stringify(state)}`);
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
    this.log("debug", `Set group ${groupId} action: ${JSON.stringify(state)}`);

    const lights = await this.lightService.getAllLights();

    // Apply state to all lights in parallel
    await Promise.all(
      Object.keys(lights).map((lightId) =>
        this.lightService
          .setLightState(lightId, state)
          .catch((err: unknown) => {
            this.log(
              "warn",
              `Group action: failed to set light ${lightId}: ${err}`,
            );
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
    this.log("warn", `Unhandled request: ${req.method} ${req.url}`);
    return {};
  }

  /**
   * Check if user is authenticated
   */
  public async isUserAuthenticated(username: string): Promise<boolean> {
    // During pairing, auto-add unknown users (Amazon Echo compatibility)
    const isAuth = await this.userService.isUserAuthenticated(username);

    if (!isAuth && this.adapter.pairingEnabled) {
      this.log("debug", `Pairing enabled, auto-adding user: ${username}`);
      await this.userService.addUser(username);
      return true;
    }

    return isAuth;
  }

  /**
   * Check if pairing is enabled
   */
  public isPairingEnabled(): boolean {
    return this.adapter.pairingEnabled;
  }

  /**
   * Check if auth is disabled
   */
  public isAuthDisabled(): boolean {
    return this.adapter.disableAuth;
  }

  /**
   * Log a message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      this.adapter.log[level](message);
    }
  }
}
