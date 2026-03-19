"use strict";
/**
 * Main API Handler - Orchestrates all Hue API services
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiHandler = void 0;
const errors_1 = require("../types/errors");
const user_service_1 = require("./user-service");
const light_service_1 = require("./light-service");
const config_service_1 = require("./config-service");
const device_binding_service_1 = require("./device-binding-service");
/**
 * Main API Handler implementation
 * Implements the HueApiHandler interface and orchestrates all services
 */
class ApiHandler {
    /**
     *
     */
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
        // Determine which light service to use
        const devices = config.devices || [];
        this.useDeviceBinding = devices.length > 0;
        if (this.useDeviceBinding) {
            // Use DeviceBindingService for admin-configured devices
            this.deviceBindingService = new device_binding_service_1.DeviceBindingService({
                adapter: config.adapter,
                devices,
                logger: config.logger,
            });
            this.lightService = this.deviceBindingService;
            this.log("debug", `Using DeviceBindingService with ${devices.length} configured devices`);
        }
        else {
            // Fall back to legacy LightService for manually created devices
            this.lightService = new light_service_1.LightService({
                adapter: config.adapter,
                logger: config.logger,
            });
            this.log("debug", "Using legacy LightService (no devices configured in admin)");
        }
    }
    /**
     * Initialize the API handler (must be called after construction)
     */
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.deviceBindingService) {
                yield this.deviceBindingService.initialize();
            }
        });
    }
    /**
     * Update state cache when a foreign state changes
     */
    onStateChange(id, value) {
        if (this.deviceBindingService) {
            this.deviceBindingService.updateStateCache(id, value);
        }
    }
    /**
     * Create a new user
     */
    createUser(req, body) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            this.log("info", `Pairing request: devicetype=${body.devicetype}, generateclientkey=${body.generateclientkey}`);
            if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
                throw errors_1.HueApiError.linkButtonNotPressed("/api");
            }
            // Use provided username or generate new one
            const providedUsername = (_a = req.body) === null || _a === void 0 ? void 0 : _a.username;
            if (providedUsername) {
                this.log("info", `Using provided username: ${providedUsername}`);
            }
            const username = yield this.userService.createUser(providedUsername, body.devicetype);
            this.log("info", `Created user: ${username}`);
            // Disable pairing after successful user creation (like real Hue bridge — link button resets after use)
            this.adapter.pairingEnabled = false;
            this.log("info", "Pairing mode disabled after successful user registration");
            return username;
        });
    }
    /**
     * Get full bridge state
     */
    getFullState(_req, username) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", `Get full state for user: ${username}`);
            const lights = yield this.lightService.getAllLights();
            const state = this.configService.buildFullState(lights);
            state.config.linkbutton = this.adapter.pairingEnabled;
            return state;
        });
    }
    /**
     * Get bridge configuration
     */
    getConfig(_req, _username) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", "Get config");
            return this.configService.getConfig();
        });
    }
    /**
     * Get all lights
     */
    getAllLights(_req, _username) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", "Get all lights");
            return this.lightService.getAllLights();
        });
    }
    /**
     * Get a single light by ID
     */
    getLightById(_req, _username, lightId) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", `Get light: ${lightId}`);
            return this.lightService.getLightById(lightId);
        });
    }
    /**
     * Set light state
     */
    setLightState(_req, _username, lightId, state) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", `Set light ${lightId} state: ${JSON.stringify(state)}`);
            return this.lightService.setLightState(lightId, state);
        });
    }
    /**
     * Set group action — applies state to all configured lights
     */
    setGroupAction(_req, _username, groupId, state) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", `Set group ${groupId} action: ${JSON.stringify(state)}`);
            const lights = yield this.lightService.getAllLights();
            // Apply state to all lights in parallel
            yield Promise.all(Object.keys(lights).map((lightId) => this.lightService
                .setLightState(lightId, state)
                .catch((err) => {
                this.log("warn", `Group action: failed to set light ${lightId}: ${err}`);
            })));
            // Return group-addressed success response (Hue API format)
            return Object.entries(state).map(([key, value]) => ({
                success: { [`/groups/${groupId}/action/${key}`]: value },
            }));
        });
    }
    /**
     * Fallback for unhandled routes
     */
    fallback(req) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("warn", `Unhandled request: ${req.method} ${req.url}`);
            return {};
        });
    }
    /**
     * Check if user is authenticated
     */
    isUserAuthenticated(username) {
        return __awaiter(this, void 0, void 0, function* () {
            // During pairing, auto-add unknown users (Amazon Echo compatibility)
            const isAuth = yield this.userService.isUserAuthenticated(username);
            if (!isAuth && this.adapter.pairingEnabled) {
                this.log("debug", `Pairing enabled, auto-adding user: ${username}`);
                yield this.userService.addUser(username);
                return true;
            }
            return isAuth;
        });
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
