"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var api_handler_exports = {};
__export(api_handler_exports, {
  ApiHandler: () => ApiHandler
});
module.exports = __toCommonJS(api_handler_exports);
var import_errors = require("../types/errors");
var import_user_service = require("./user-service");
var import_config_service = require("./config-service");
var import_device_binding_service = require("./device-binding-service");
class ApiHandler {
  adapter;
  userService;
  lightService;
  configService;
  logger;
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
    this.userService = new import_user_service.UserService({
      adapter: config.adapter,
      logger: config.logger
    });
    this.configService = new import_config_service.ConfigService(config.configServiceConfig);
    const devices = config.devices || [];
    this.lightService = new import_device_binding_service.DeviceBindingService({
      adapter: config.adapter,
      devices,
      logger: config.logger
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
    var _a;
    this.log(
      "debug",
      `Pairing request: devicetype=${body.devicetype}, generateclientkey=${body.generateclientkey}`
    );
    if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
      throw import_errors.HueApiError.linkButtonNotPressed("/api");
    }
    const providedUsername = (_a = req.body) == null ? void 0 : _a.username;
    if (providedUsername) {
      this.log("debug", `Using provided username: ${providedUsername}`);
    }
    const username = await this.userService.createUser(
      providedUsername,
      body.devicetype
    );
    this.log("info", `Paired client "${body.devicetype}" as user ${username}`);
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
    await Promise.all(
      Object.keys(lights).map(
        (lightId) => this.lightService.setLightState(lightId, state).catch((err) => {
          this.log(
            "warn",
            `Group action: failed to set light ${lightId}: ${err}`
          );
        })
      )
    );
    return Object.entries(state).map(([key, value]) => ({
      success: { [`/groups/${groupId}/action/${key}`]: value }
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
  log(level, message) {
    this.logger[level](message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApiHandler
});
//# sourceMappingURL=api-handler.js.map
