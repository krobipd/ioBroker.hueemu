"use strict";
/**
 * Main API Handler - Orchestrates all Hue API services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiHandler = void 0;
const errors_1 = require("../types/errors");
const user_service_1 = require("./user-service");
const config_service_1 = require("./config-service");
const device_binding_service_1 = require("./device-binding-service");
/**
 * Main API Handler implementation
 * Implements the HueApiHandler interface and orchestrates all services
 */
class ApiHandler {
    adapter;
    userService;
    lightService;
    configService;
    logger;
    constructor(config) {
        this.adapter = config.adapter;
        this.logger = config.logger;
        // Initialize user service
        this.userService = new user_service_1.UserService({
            adapter: config.adapter,
            logger: config.logger,
        });
        // Initialize config service
        this.configService = new config_service_1.ConfigService(config.configServiceConfig);
        // Initialize device binding service
        const devices = config.devices || [];
        this.lightService = new device_binding_service_1.DeviceBindingService({
            adapter: config.adapter,
            devices,
            logger: config.logger,
        });
        this.log("debug", `${devices.length} device(s) configured`);
    }
    /**
     * Initialize the API handler (must be called after construction)
     */
    async initialize() {
        await this.lightService.initialize();
    }
    /**
     * Update state cache when a foreign state changes
     */
    onStateChange(id, value) {
        this.lightService.updateStateCache(id, value);
    }
    /**
     * Create a new user
     */
    async createUser(req, body) {
        this.log("debug", `Pairing request: devicetype=${body.devicetype}, generateclientkey=${body.generateclientkey}`);
        if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
            throw errors_1.HueApiError.linkButtonNotPressed("/api");
        }
        // Use provided username or generate new one
        const providedUsername = req.body?.username;
        if (providedUsername) {
            this.log("debug", `Using provided username: ${providedUsername}`);
        }
        const username = await this.userService.createUser(providedUsername, body.devicetype);
        this.log("info", `Paired client "${body.devicetype}" as user ${username}`);
        // Disable pairing after successful user creation (like real Hue bridge — link button resets after use)
        this.adapter.pairingEnabled = false;
        return username;
    }
    /**
     * Get full bridge state
     */
    async getFullState(_req, username) {
        this.log("debug", `Get full state for user: ${username}`);
        const lights = await this.lightService.getAllLights();
        const state = this.configService.buildFullState(lights);
        state.config.linkbutton = this.adapter.pairingEnabled;
        return state;
    }
    /**
     * Get bridge configuration
     */
    async getConfig(_req, _username) {
        this.log("debug", "Get config");
        return this.configService.getConfig();
    }
    /**
     * Get all lights
     */
    async getAllLights(_req, _username) {
        this.log("debug", "Get all lights");
        return this.lightService.getAllLights();
    }
    /**
     * Get a single light by ID
     */
    async getLightById(_req, _username, lightId) {
        this.log("debug", `Get light: ${lightId}`);
        return this.lightService.getLightById(lightId);
    }
    /**
     * Set light state
     */
    async setLightState(_req, _username, lightId, state) {
        this.log("debug", `Set light ${lightId} state: ${JSON.stringify(state)}`);
        return this.lightService.setLightState(lightId, state);
    }
    /**
     * Set group action — applies state to all configured lights
     */
    async setGroupAction(_req, _username, groupId, state) {
        this.log("debug", `Set group ${groupId} action: ${JSON.stringify(state)}`);
        const lights = await this.lightService.getAllLights();
        // Apply state to all lights in parallel
        await Promise.all(Object.keys(lights).map((lightId) => this.lightService
            .setLightState(lightId, state)
            .catch((err) => {
            this.log("warn", `Group action: failed to set light ${lightId}: ${err}`);
        })));
        // Return group-addressed success response (Hue API format)
        return Object.entries(state).map(([key, value]) => ({
            success: { [`/groups/${groupId}/action/${key}`]: value },
        }));
    }
    /**
     * Fallback for unhandled routes
     */
    async fallback(req) {
        this.log("warn", `Unhandled request: ${req.method} ${req.url}`);
        return {};
    }
    /**
     * Check if user is authenticated
     */
    async isUserAuthenticated(username) {
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
    isPairingEnabled() {
        return this.adapter.pairingEnabled;
    }
    /**
     * Check if auth is disabled
     */
    isAuthDisabled() {
        return this.adapter.disableAuth;
    }
    /**
     * Log a message
     */
    log(level, message) {
        if (this.logger) {
            this.logger[level](message);
        }
        else {
            this.adapter.log[level](message);
        }
    }
}
exports.ApiHandler = ApiHandler;
//# sourceMappingURL=api-handler.js.map