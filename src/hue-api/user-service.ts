/**
 * User/Authentication Service for Hue API
 */

// import * as utils from '@iobroker/adapter-core';
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
   * Add a new user
   */
  public async addUser(
    username: string,
    devicetype = "unknown",
  ): Promise<void> {
    this.log("info", `Creating user: ${username} for device: ${devicetype}`);

    // Ensure user folder exists
    await this.ensureUserFolder();

    // Create user state
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
            write: false,
          },
          native: { username },
        },
        () => {
          this.adapter.setState(
            `user.${username}`,
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
   * Check if a user is authenticated
   */
  public async isUserAuthenticated(username: string): Promise<boolean> {
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
  }

  /**
   * Ensure the user folder exists
   */
  private async ensureUserFolder(): Promise<void> {
    return new Promise((resolve) => {
      this.adapter.setObjectNotExists(
        "user",
        {
          type: "meta",
          common: {
            name: "user",
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
