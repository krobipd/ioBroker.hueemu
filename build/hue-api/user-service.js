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
class UserService {
  adapter;
  logger;
  /**
   *
   */
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }
  /**
   * Add a new user
   */
  async addUser(username, devicetype = "unknown") {
    this.log("debug", `Creating user: ${username} for device: ${devicetype}`);
    await this.ensureUserFolder();
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        `user.${username}`,
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
        () => {
          this.adapter.setState(
            `user.${username}`,
            {
              ack: true,
              val: username
            },
            () => {
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
   * Check if a user is authenticated
   */
  async isUserAuthenticated(username) {
    return new Promise((resolve) => {
      this.adapter.getStatesOf("user", void 0, (err, stateObjects) => {
        if (err || !stateObjects) {
          this.log("debug", `No user states found: ${err}`);
          resolve(false);
          return;
        }
        const found = stateObjects.some((state) => {
          const id = state._id.substring(this.adapter.namespace.length + 6);
          return id === username;
        });
        if (found) {
          this.log("debug", `User authenticated: ${username}`);
        }
        resolve(found);
      });
    });
  }
  /**
   * Ensure the user folder exists
   */
  async ensureUserFolder() {
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        "user",
        {
          type: "meta",
          common: {
            name: "user",
            type: "meta.folder"
          },
          native: {}
        },
        () => {
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
