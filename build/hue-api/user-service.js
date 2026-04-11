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
var import_utils = require("../types/utils");
class UserService {
  adapter;
  logger;
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }
  /**
   * Add a new client (Hue API "user")
   */
  async addUser(username, devicetype = "unknown") {
    const safeUsername = (0, import_utils.sanitizeId)(username);
    this.log("debug", `Creating client: ${safeUsername} (${devicetype})`);
    await this.ensureClientsFolder();
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        `clients.${safeUsername}`,
        {
          type: "state",
          common: {
            name: devicetype,
            type: "string",
            role: "text",
            read: true,
            write: false
          },
          native: { username }
        },
        (err) => {
          if (err) {
            this.log(
              "warn",
              `Failed to create client object ${safeUsername}: ${err}`
            );
          }
          this.adapter.setState(
            `clients.${safeUsername}`,
            {
              ack: true,
              val: username
            },
            (err2) => {
              if (err2) {
                this.log(
                  "warn",
                  `Failed to set client state ${safeUsername}: ${err2}`
                );
              }
              resolve();
            }
          );
        }
      );
    });
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
    return new Promise((resolve) => {
      this.adapter.getStatesOf("clients", void 0, (err, stateObjects) => {
        if (err || !stateObjects) {
          this.log("debug", `No client states found: ${err}`);
          resolve(false);
          return;
        }
        const found = stateObjects.some((state) => {
          const id = state._id.substring(this.adapter.namespace.length + 9);
          return id === safeUsername;
        });
        if (found) {
          this.log("debug", `Client authenticated: ${username}`);
        }
        resolve(found);
      });
    });
  }
  /**
   * Ensure the clients folder exists
   */
  async ensureClientsFolder() {
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        "clients",
        {
          type: "meta",
          common: {
            name: "Paired Clients",
            type: "meta.folder"
          },
          native: {}
        },
        (err) => {
          if (err) {
            this.log("warn", `Failed to create clients folder: ${err}`);
          }
          resolve();
        }
      );
    });
  }
  /**
   * Log a message
   */
  log(level, message) {
    if (this.logger) {
      this.logger[level](message);
    } else {
      this.adapter.log[level](message);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  UserService
});
//# sourceMappingURL=user-service.js.map
