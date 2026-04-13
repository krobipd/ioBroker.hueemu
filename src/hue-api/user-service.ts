/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";
import { sanitizeId } from "../types/utils";

/**
 * Adapter interface for user service
 */
export interface UserServiceAdapter {
  namespace: string;
  log: ioBroker.Logger;
  setObjectNotExistsAsync(
    id: string,
    obj: ioBroker.SettableObject,
  ): Promise<{ id: string }>;
  setStateAsync(
    id: string,
    state: ioBroker.SettableState,
  ): Promise<{ id: string }>;
  getStatesOfAsync(
    parentDevice?: string,
    parentChannel?: string,
  ): Promise<ioBroker.StateObject[]>;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  /** Adapter instance */
  adapter: UserServiceAdapter;
  /** Logger */
  logger: Logger;
}

/**
 * Service for managing Hue API users
 */
export class UserService {
  private readonly adapter: UserServiceAdapter;
  private readonly logger: Logger;

  constructor(config: UserServiceConfig) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }

  /**
   * Add a new client (Hue API "user")
   */
  public async addUser(
    username: string,
    devicetype = "unknown",
  ): Promise<void> {
    const safeUsername = sanitizeId(username);
    this.log("debug", `Creating client: ${safeUsername} (${devicetype})`);

    // Ensure clients folder exists
    await this.ensureClientsFolder();

    // Create client state (sanitizeId: FORBIDDEN_CHARS compliance)
    try {
      await this.adapter.setObjectNotExistsAsync(`clients.${safeUsername}`, {
        type: "state",
        common: {
          name: devicetype,
          type: "string",
          role: "text",
          read: true,
          write: false,
        },
        native: { username },
      });
    } catch (err) {
      this.log(
        "warn",
        `Failed to create client object ${safeUsername}: ${err}`,
      );
    }

    try {
      await this.adapter.setStateAsync(`clients.${safeUsername}`, {
        ack: true,
        val: username,
      });
    } catch (err) {
      this.log("warn", `Failed to set client state ${safeUsername}: ${err}`);
    }
  }

  /**
   * Create a new user with optional provided username
   */
  public async createUser(
    providedUsername?: string,
    devicetype = "unknown",
  ): Promise<string> {
    const username =
      providedUsername && providedUsername.length > 0
        ? providedUsername
        : uuid.v4();

    await this.addUser(username, devicetype);
    return username;
  }

  /**
   * Check if a client is authenticated (has paired with the bridge)
   */
  public async isUserAuthenticated(username: string): Promise<boolean> {
    const safeUsername = sanitizeId(username);

    let stateObjects: ioBroker.StateObject[];
    try {
      stateObjects = await this.adapter.getStatesOfAsync("clients", undefined);
    } catch (err) {
      this.log("debug", `No client states found: ${err}`);
      return false;
    }

    if (!stateObjects || stateObjects.length === 0) {
      return false;
    }

    const found = stateObjects.some((state) => {
      const id = state._id.substring(this.adapter.namespace.length + 9); // +1 for '.' and +8 for 'clients.'
      return id === safeUsername;
    });

    if (found) {
      this.log("debug", `Client authenticated: ${username}`);
    }

    return found;
  }

  /**
   * Ensure the clients folder exists
   */
  private async ensureClientsFolder(): Promise<void> {
    try {
      await this.adapter.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: {
          name: "Paired Clients",
          type: "meta.folder",
        },
        native: {},
      });
    } catch (err) {
      this.log("warn", `Failed to create clients folder: ${err}`);
    }
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    this.logger[level](message);
  }
}
