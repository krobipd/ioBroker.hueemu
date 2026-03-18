"use strict";
/**
 * User/Authentication Service for Hue API
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
exports.UserService = void 0;
const uuid = require("uuid");
/**
 * Service for managing Hue API users
 */
class UserService {
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
    addUser(username_1) {
        return __awaiter(this, arguments, void 0, function* (username, devicetype = "unknown") {
            this.log("info", `Creating user: ${username} for device: ${devicetype}`);
            // Ensure user folder exists
            yield this.ensureUserFolder();
            // Create user state
            return new Promise((resolve) => {
                this.adapter.setObjectNotExists(`user.${username}`, {
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
                    this.adapter.setState(`user.${username}`, {
                        ack: true,
                        val: username,
                    }, () => {
                        resolve();
                    });
                });
            });
        });
    }
    /**
     * Create a new user with optional provided username
     */
    createUser(providedUsername_1) {
        return __awaiter(this, arguments, void 0, function* (providedUsername, devicetype = "unknown") {
            const username = providedUsername && providedUsername.length > 0
                ? providedUsername
                : uuid.v4();
            yield this.addUser(username, devicetype);
            return username;
        });
    }
    /**
     * Check if a user is authenticated
     */
    isUserAuthenticated(username) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve) => {
                this.adapter.getStatesOf("user", undefined, (err, stateObjects) => {
                    if (err || !stateObjects) {
                        this.log("debug", `No user states found: ${err}`);
                        resolve(false);
                        return;
                    }
                    const found = stateObjects.some((state) => {
                        const id = state._id.substring(this.adapter.namespace.length + 6); // +1 for '.' and +5 for 'user.'
                        return id === username;
                    });
                    if (found) {
                        this.log("debug", `User authenticated: ${username}`);
                    }
                    resolve(found);
                });
            });
        });
    }
    /**
     * Ensure the user folder exists
     */
    ensureUserFolder() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve) => {
                this.adapter.setObjectNotExists("user", {
                    type: "meta",
                    common: {
                        name: "user",
                        type: "meta.folder",
                    },
                    native: {},
                }, () => {
                    resolve();
                });
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
