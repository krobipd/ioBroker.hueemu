"use strict";
/**
 * User/Authentication Service for Hue API
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const uuid = __importStar(require("uuid"));
const utils_1 = require("../types/utils");
/**
 * Service for managing Hue API users
 */
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
        const safeUsername = (0, utils_1.sanitizeId)(username);
        this.log("debug", `Creating client: ${safeUsername} (${devicetype})`);
        // Ensure clients folder exists
        await this.ensureClientsFolder();
        // Create client state (sanitizeId: FORBIDDEN_CHARS compliance)
        return new Promise((resolve) => {
            this.adapter.setObjectNotExists(`clients.${safeUsername}`, {
                type: "state",
                common: {
                    name: devicetype,
                    type: "string",
                    role: "text",
                    read: true,
                    write: false,
                },
                native: { username },
            }, (err) => {
                if (err) {
                    this.log("warn", `Failed to create client object ${safeUsername}: ${err}`);
                }
                this.adapter.setState(`clients.${safeUsername}`, {
                    ack: true,
                    val: username,
                }, (err2) => {
                    if (err2) {
                        this.log("warn", `Failed to set client state ${safeUsername}: ${err2}`);
                    }
                    resolve();
                });
            });
        });
    }
    /**
     * Create a new user with optional provided username
     */
    async createUser(providedUsername, devicetype = "unknown") {
        const username = providedUsername && providedUsername.length > 0
            ? providedUsername
            : uuid.v4();
        await this.addUser(username, devicetype);
        return username;
    }
    /**
     * Check if a client is authenticated (has paired with the bridge)
     */
    async isUserAuthenticated(username) {
        const safeUsername = (0, utils_1.sanitizeId)(username);
        return new Promise((resolve) => {
            this.adapter.getStatesOf("clients", undefined, (err, stateObjects) => {
                if (err || !stateObjects) {
                    this.log("debug", `No client states found: ${err}`);
                    resolve(false);
                    return;
                }
                const found = stateObjects.some((state) => {
                    const id = state._id.substring(this.adapter.namespace.length + 9); // +1 for '.' and +8 for 'clients.'
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
            this.adapter.setObjectNotExists("clients", {
                type: "meta",
                common: {
                    name: "Paired Clients",
                    type: "meta.folder",
                },
                native: {},
            }, (err) => {
                if (err) {
                    this.log("warn", `Failed to create clients folder: ${err}`);
                }
                resolve();
            });
        });
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
exports.UserService = UserService;
//# sourceMappingURL=user-service.js.map