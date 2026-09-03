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
  CLIENT_CREATE_CEILING_PER_HOUR: () => CLIENT_CREATE_CEILING_PER_HOUR,
  MAX_DEVICETYPE_LENGTH: () => MAX_DEVICETYPE_LENGTH,
  MAX_USERNAME_LENGTH: () => MAX_USERNAME_LENGTH,
  UserService: () => UserService
});
module.exports = __toCommonJS(user_service_exports);
var uuid = __toESM(require("uuid"));
var import_i18n = require("../lib/i18n");
var import_utils = require("../types/utils");
const AUTO_ADD_CAP_PER_WINDOW = 64;
const CLIENT_CREATE_CEILING_PER_HOUR = 100;
const CLIENT_CREATE_WINDOW_MS = 60 * 60 * 1e3;
const MAX_USERNAME_LENGTH = 64;
const MAX_DEVICETYPE_LENGTH = 100;
class UserService {
  adapter;
  logger;
  /**
   * v1.4.3 (U2): in-memory mirror of paired client ids. Populated lazily on
   * first lookup, kept in sync by every `addUser`. Earlier every Hue API
   * request triggered `getStatesOfAsync("clients")`, hitting the broker on
   * every call — Echo polls the bridge frequently.
   */
  clientIdsCache = null;
  /**
   * v1.4.3 (U1+R2): defense-in-depth counter for auto-added clients in the
   * current pairing window. Reset by {@link resetAutoAddBudget} which the
   * adapter calls when pairing flips on.
   */
  autoAddedThisWindow = 0;
  autoAddCapWarned = false;
  /** Fixed hourly window for {@link CLIENT_CREATE_CEILING_PER_HOUR}; starts with the first creation. */
  createWindow = { startedAt: 0, count: 0, warned: false };
  /**
   * Create a new user service
   *
   * @param config - User service configuration
   */
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }
  /**
   * Reset the auto-add counter — call when a new pairing window opens so
   * every press of the link button gets a fresh budget.
   */
  resetAutoAddBudget() {
    this.autoAddedThisWindow = 0;
    this.autoAddCapWarned = false;
  }
  /**
   * Throw when the hourly ceiling is already used up (warns once per window).
   * The window is fixed, not sliding: it starts with the first creation and the
   * counter is zeroed when a new one starts — never a counter that only rises.
   *
   * v1.15.0: this only CHECKS. Counting moved to {@link countCreatedClient},
   * which runs after a client was really persisted. Counting the attempt let
   * rejected requests eat the budget: 64 auto-adds plus the auto-add cap's own
   * rejections exhausted all 100 slots inside one 50-second pairing window, and
   * the owner's next manual pairing was refused for the rest of the hour
   * (measured, 2026-09-03 audit F5). It still runs BEFORE the object write, so a
   * request over the ceiling creates nothing.
   */
  enforceCreateCeiling() {
    const now = Date.now();
    if (now - this.createWindow.startedAt >= CLIENT_CREATE_WINDOW_MS) {
      this.createWindow = { startedAt: now, count: 0, warned: false };
    }
    if (this.createWindow.count >= CLIENT_CREATE_CEILING_PER_HOUR) {
      if (!this.createWindow.warned) {
        this.createWindow.warned = true;
        this.logger.warn(
          `Client creation ceiling reached (${CLIENT_CREATE_CEILING_PER_HOUR} new clients within one hour) \u2014 further pairing requests are rejected until the hour is over (a misbehaving client, or disableAuth on an untrusted network?)`
        );
      }
      throw new Error("Client creation ceiling reached for this hour");
    }
  }
  /**
   * Book one actually-created client against the hourly ceiling. Only called
   * once the client is persisted and new — a re-pairing under an existing name
   * costs nothing, and neither does a creation whose object write failed.
   */
  countCreatedClient() {
    this.createWindow.count += 1;
  }
  /**
   * Add a new client (Hue API "user").
   *
   * @param username Raw username (will be sanitized for the state id).
   * @param devicetype Client-supplied device type (purely informational).
   * @param viaAutoAdd `true` when called from the pairing-window auto-add
   *   path — counts against the per-window cap. `false` for explicit
   *   `POST /api` createUser calls (gated by the link button and the hourly ceiling).
   */
  async addUser(username, devicetype = "unknown", viaAutoAdd = false) {
    var _a;
    this.enforceCreateCeiling();
    if (viaAutoAdd) {
      if (this.autoAddedThisWindow >= AUTO_ADD_CAP_PER_WINDOW) {
        if (!this.autoAddCapWarned) {
          this.logger.warn(
            `Auto-add cap reached (${AUTO_ADD_CAP_PER_WINDOW} clients in this pairing window) \u2014 further unknown clients will be rejected until pairing is re-enabled`
          );
          this.autoAddCapWarned = true;
        }
        throw new Error("Auto-add cap reached for this pairing window");
      }
      this.autoAddedThisWindow += 1;
    }
    const safeUsername = (0, import_utils.sanitizeId)(username);
    this.logger.debug(`Creating client: ${safeUsername} (${(0, import_utils.oneLine)(devicetype)})`);
    await this.ensureClientsFolder();
    const cache = await this.ensureCache();
    const isNewClient = !cache.has(safeUsername);
    let persisted = false;
    try {
      await this.adapter.setObjectNotExistsAsync(`clients.${safeUsername}`, {
        type: "state",
        common: {
          name: devicetype.slice(0, MAX_DEVICETYPE_LENGTH),
          type: "string",
          role: "text",
          read: true,
          write: false
        },
        native: { username }
      });
      persisted = true;
    } catch (err) {
      this.logger.warn(`Failed to create client object ${safeUsername}: ${(0, import_utils.errText)(err)}`);
    }
    try {
      await this.adapter.setStateAsync(`clients.${safeUsername}`, {
        ack: true,
        val: username
      });
    } catch (err) {
      this.logger.warn(`Failed to set client state ${safeUsername}: ${(0, import_utils.errText)(err)}`);
    }
    if (isNewClient && persisted) {
      this.countCreatedClient();
    }
    (_a = this.clientIdsCache) == null ? void 0 : _a.add(safeUsername);
  }
  /**
   * Returns the paired client ids (sanitized form) currently in the cache —
   * empty until the first auth check populates it. Synchronous on purpose so
   * the whitelist render-path (config-service) needn't become async.
   */
  listCachedClientIds() {
    return this.clientIdsCache ? [...this.clientIdsCache] : [];
  }
  /**
   * Create a new user with optional provided username
   *
   * @param providedUsername - Pre-defined username (generates UUID if empty)
   * @param devicetype - Client device type string
   */
  async createUser(providedUsername, devicetype = "unknown") {
    const username = providedUsername && providedUsername.length > 0 ? providedUsername : uuid.v4();
    await this.addUser(username, devicetype);
    return username;
  }
  /**
   * Check if a client is authenticated (has paired with the bridge).
   *
   * v1.4.3 (U2): in-memory client-id set populated lazily; hits the broker
   * once on the first call after start, then served from RAM. Hue clients
   * (Echo, Harmony) poll `/api/{user}` frequently — earlier each call did
   * a `getStatesOfAsync` round-trip.
   *
   * @param username - Username to verify
   */
  async isUserAuthenticated(username) {
    const safeUsername = (0, import_utils.sanitizeId)(username);
    const cache = await this.ensureCache();
    const found = cache.has(safeUsername);
    if (found) {
      this.logger.debug(`Client authenticated: ${(0, import_utils.oneLine)(username)}`);
    }
    return found;
  }
  /** Build (or return) the cache of sanitized client ids. */
  async ensureCache() {
    if (this.clientIdsCache) {
      return this.clientIdsCache;
    }
    const cache = /* @__PURE__ */ new Set();
    try {
      const stateObjects = await this.adapter.getStatesOfAsync("clients", void 0) || [];
      const offset = this.adapter.namespace.length + 1 + "clients.".length;
      for (const state of stateObjects) {
        const id = state._id.substring(offset);
        if (id) {
          cache.add(id);
        }
      }
    } catch (err) {
      this.logger.warn(`Could not load clients into cache, retrying on next request: ${(0, import_utils.errText)(err)}`);
      return cache;
    }
    this.clientIdsCache = cache;
    return cache;
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
          name: (0, import_i18n.tName)("clientsFolder"),
          type: "meta.folder"
        },
        native: {}
      });
    } catch (err) {
      this.logger.warn(`Failed to create clients folder: ${(0, import_utils.errText)(err)}`);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLIENT_CREATE_CEILING_PER_HOUR,
  MAX_DEVICETYPE_LENGTH,
  MAX_USERNAME_LENGTH,
  UserService
});
//# sourceMappingURL=user-service.js.map
