/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";

/**
 * Adapter interface for user service
 */
export interface UserServiceAdapter {
  namespace: string;
  /**
   *
   */
  log: ioBroker.Logger;
  setObjectNotExists(
    id: string,
    obj: ioBroker.SettableObject,
    callback?: ioBroker.SetObjectCallback,
  ): void;
  setState(
    id: string,
    state: ioBroker.SettableState,
    callback?: ioBroker.SetStateCallback,
  ): void;
  getStatesOf(
    parentDevice: string | undefined,
    parentChannel: string | undefined,
    callback: ioBroker.GetObjectsCallback3<ioBroker.StateObject>,
  ): void;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  /** Adapter instance */
  adapter: UserServiceAdapter;
  /** Optional logger */
  logger?: Logger;
}

/**
 * Service for managing Hue API users
 */
export class UserService {
  private readonly adapter: UserServiceAdapter;
  private readonly logger?: Logger;

  /**
   *
   */
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
    this.log("debug", `Creating client: ${username} (${devicetype})`);

    // Ensure clients folder exists
    await this.ensureClientsFolder();

    // Create client state
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        `clients.${username}`,
        {
          type: "state",
          common: {
            name: devicetype,
            type: "string",
            role: "text",
            read: true,
            write: false,
          },
          native: { username },
        },
        () => {
          this.adapter.setState(
            `clients.${username}`,
            {
              ack: true,
              val: username,
            },
            () => {
              resolve();
            },
          );
        },
      );
    });
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
    return new Promise((resolve) => {
      this.adapter.getStatesOf("clients", undefined, (err, stateObjects) => {
        if (err || !stateObjects) {
          this.log("debug", `No client states found: ${err}`);
          resolve(false);
          return;
        }

        const found = stateObjects.some((state) => {
          const id = state._id.substring(this.adapter.namespace.length + 9); // +1 for '.' and +8 for 'clients.'
          return id === username;
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
  private async ensureClientsFolder(): Promise<void> {
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        "clients",
        {
          type: "meta",
          common: {
            name: "Paired Clients",
            type: "meta.folder",
          },
          native: {},
        },
        () => {
          resolve();
        },
      );
    });
  }

  /**
   * Log a message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      this.adapter.log[level](message);
    }
  }
}
