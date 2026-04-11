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
/**
 * Sanitize a string for use as ioBroker object ID segment.
 * Replaces everything except [A-Za-z0-9-_] with underscore.
 * See: adapter.FORBIDDEN_CHARS, ioBroker object ID requirements.
 */
function sanitizeId(id) {
    return id.replace(/[^A-Za-z0-9\-_]/g, "_");
}
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
        const safeUsername = sanitizeId(username);
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
            }, () => {
                this.adapter.setState(`clients.${safeUsername}`, {
                    ack: true,
                    val: username,
                }, () => {
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
        const safeUsername = sanitizeId(username);
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
            }, () => {
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