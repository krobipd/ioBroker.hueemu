"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var user_service_exports = {};
__export(user_service_exports, {
  UserService: () => UserService
});
module.exports = __toCommonJS(user_service_exports);
var uuid = __toESM(require("uuid"));
var import_i18n_logs = require("../lib/i18n-logs");
var import_i18n_states = require("../lib/i18n-states");
var import_utils = require("../types/utils");
class UserService {
  adapter;
  logger;
  systemLang;
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
    this.systemLang = config.systemLang;
  }
  /**
   * Add a new client (Hue API "user")
   */
  async addUser(username, devicetype = "unknown") {
    const safeUsername = (0, import_utils.sanitizeId)(username);
    this.log("debug", `Creating client: ${safeUsername} (${devicetype})`);
    await this.ensureClientsFolder();
    try {
      await this.adapter.setObjectNotExistsAsync(`clients.${safeUsername}`, {
        type: "state",
        common: {
          name: devicetype,
          type: "string",
          role: "text",
          read: true,
          write: false
        },
        native: { username }
      });
    } catch (err) {
      this.logger.warn((0, import_i18n_logs.tLog)(this.systemLang, "clientObjectFailed", { username: safeUsername, error: (0, import_utils.errText)(err) }));
    }
    try {
      await this.adapter.setStateAsync(`clients.${safeUsername}`, {
        ack: true,
        val: username
      });
    } catch (err) {
      this.logger.warn((0, import_i18n_logs.tLog)(this.systemLang, "clientStateFailed", { username: safeUsername, error: (0, import_utils.errText)(err) }));
    }
  }
  /**
   * Create a new user with optional provided username
   */
  async createUser(providedUsername, devicetype = "unknown") {
    const username = providedUsername && providedUsername.length > 0 ? providedUsername : uuid.v4();
    await this.addUser(username, devicetype);
    return username;
  }
  /**
   * Check if a client is authenticated (has paired with the bridge)
   */
  async isUserAuthenticated(username) {
    const safeUsername = (0, import_utils.sanitizeId)(username);
    let stateObjects;
    try {
      stateObjects = await this.adapter.getStatesOfAsync("clients", void 0);
    } catch (err) {
      this.log("debug", `No client states found: ${err}`);
      return false;
    }
    if (!stateObjects || stateObjects.length === 0) {
      return false;
    }
    const found = stateObjects.some((state) => {
      const id = state._id.substring(this.adapter.namespace.length + 9);
      return id === safeUsername;
    });
    if (found) {
      this.log("debug", `Client authenticated: ${username}`);
    }
    return found;
  }
  /**
   * Ensure the clients folder exists. io-package.json declares it as
   * instanceObject with a translation-object name, so this typically skips.
   * Defensive re-create only triggers when the folder was deleted manually —
   * we hand the same translation object so the folder name stays localized.
   */
  async ensureClientsFolder() {
    try {
      await this.adapter.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: {
          name: (0, import_i18n_states.tName)("clientsFolder"),
          type: "meta.folder"
        },
        native: {}
      });
    } catch (err) {
      this.logger.warn((0, import_i18n_logs.tLog)(this.systemLang, "clientsFolderFailed", { error: (0, import_utils.errText)(err) }));
    }
  }
  log(level, message) {
    this.logger[level](message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  UserService
});
//# sourceMappingURL=user-service.js.map
