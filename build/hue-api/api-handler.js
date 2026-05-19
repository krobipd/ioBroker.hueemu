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
var import_utils = require("../types/utils");
var import_user_service = require("./user-service");
var import_config_service = require("./config-service");
var import_device_binding_service = require("./device-binding-service");
class ApiHandler {
  adapter;
  userService;
  lightService;
  configService;
  logger;
  /**
   * Create a new API handler and initialize all services
   *
   * @param config - API handler configuration
   */
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
    this.userService = new import_user_service.UserService({
      adapter: config.adapter,
      logger: config.logger
    });
    this.configService = new import_config_service.ConfigService({
      ...config.configServiceConfig,
      whitelistProvider: () => this.userService.listCachedClientIds()
    });
    const devices = config.devices || [];
    this.lightService = new import_device_binding_service.DeviceBindingService({
      adapter: config.adapter,
      devices,
      logger: config.logger
    });
    this.logger.debug(`${devices.length} device(s) configured`);
  }
  /**
   * Initialize the API handler (must be called after construction)
   */
  async initialize() {
    await this.lightService.initialize();
  }
  /**
   * Update state cache when a foreign state changes
   *
   * @param id - Full state ID that changed
   * @param value - New state value
   */
  onStateChange(id, value) {
    this.lightService.updateStateCache(id, value);
  }
  /**
   * Create a new user
   *
   * @param req - Incoming HTTP request
   * @param body - User creation request body
   */
  async createUser(req, body) {
    var _a;
    const devicetype = typeof body.devicetype === "string" && body.devicetype.length > 0 ? body.devicetype : "unknown";
    this.logger.debug(`Pairing request: devicetype=${devicetype}, generateclientkey=${body.generateclientkey}`);
    if (!this.adapter.disableAuth && !this.adapter.pairingEnabled) {
      throw import_errors.HueApiError.linkButtonNotPressed("/api");
    }
    const rawUsername = (_a = req.body) == null ? void 0 : _a.username;
    const providedUsername = typeof rawUsername === "string" && rawUsername.length > 0 ? rawUsername : void 0;
    if (providedUsername) {
      this.logger.debug(`Using provided username: ${providedUsername}`);
    }
    const username = await this.userService.createUser(providedUsername, devicetype);
    this.logger.info(`Paired client "${devicetype}" as user ${username}`);
    this.adapter.pairingEnabled = false;
    return username;
  }
  /**
   * Get full bridge state
   *
   * @param _req - Incoming HTTP request (unused)
   * @param username - Authenticated username
   */
  async getFullState(_req, username) {
    this.logger.debug(`Get full state for user: ${username}`);
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
  getConfig(_req, _username) {
    this.logger.debug("Get config");
    return this.configService.getConfig();
  }
  /**
   * Get all lights
   *
   * @param _req - Incoming HTTP request (unused)
   * @param _username - Authenticated username (unused)
   */
  async getAllLights(_req, _username) {
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
  async getLightById(_req, _username, lightId) {
    this.logger.debug(`Get light: ${lightId}`);
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
  async setLightState(_req, _username, lightId, state) {
    this.logger.debug(`Set light ${lightId} state: ${JSON.stringify(state)}`);
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
  async setGroupAction(_req, _username, groupId, state) {
    this.logger.debug(`Set group ${groupId} action: ${JSON.stringify(state)}`);
    const lights = await this.lightService.getAllLights();
    await Promise.all(
      Object.keys(lights).map(
        (lightId) => this.lightService.setLightState(lightId, state).catch((err) => {
          this.logger.warn(`Group action: failed to set light ${lightId}: ${(0, import_utils.errText)(err)}`);
        })
      )
    );
    return Object.entries(state).map(([key, value]) => ({
      success: { [`/groups/${groupId}/action/${key}`]: value }
    }));
  }
  /**
   * Fallback for unhandled routes
   *
   * @param req - Incoming HTTP request
   */
  fallback(req) {
    this.logger.warn(`Unhandled request: ${req.method} ${req.url}`);
    return {};
  }
  /**
   * Check if user is authenticated
   *
   * @param username - Username to check
   */
  async isUserAuthenticated(username) {
    const isAuth = await this.userService.isUserAuthenticated(username);
    if (!isAuth && this.adapter.pairingEnabled) {
      try {
        await this.userService.addUser(username, "auto-paired", true);
        this.logger.debug(`Pairing enabled, auto-added user: ${username}`);
        return true;
      } catch (err) {
        this.logger.warn(`Auto-add rejected for ${username}: ${(0, import_utils.errText)(err)}`);
        return false;
      }
    }
    return isAuth;
  }
  /** Reset the per-pairing-window auto-add budget (called on pairing-on). */
  resetAutoAddBudget() {
    this.userService.resetAutoAddBudget();
  }
  /**
   * Check if auth is disabled
   */
  isAuthDisabled() {
    return this.adapter.disableAuth;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ApiHandler
});
//# sourceMappingURL=api-handler.js.map
