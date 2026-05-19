/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";
import { tName } from "../lib/i18n-states";
import { errText, sanitizeId } from "../types/utils";

/**
 * Adapter interface for user service
 */
export interface UserServiceAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** ioBroker logger */
  log: ioBroker.Logger;
  /** Create an object if it does not exist */
  setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): Promise<{ id: string }>;
  /** Set a state value */
  setStateAsync(id: string, state: ioBroker.SettableState): Promise<{ id: string }>;
  /** Get all state objects under a parent */
  getStatesOfAsync(parentDevice?: string, parentChannel?: string): Promise<ioBroker.StateObject[]>;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  /** Adapter instance */
  adapter: UserServiceAdapter;
  /** Logger */
  logger: Logger;
  /** ioBroker system language for user-facing log strings */
}

/**
 * v1.4.3 (U1+R2): cap on auto-added clients within a single pairing window.
 * The auto-add path in `ApiHandler.isUserAuthenticated` accepts any unknown
 * username during the 50 s pairing window — necessary for Echo/Harmony
 * compatibility, but a misbehaving (or hostile) client could create
 * thousands of permanent client records over those seconds. Real Hue
 * bridges press only one pair per button-press; we keep the auto-add for
 * compat but cap the total per window. Manual `createUser` (POST /api with
 * the link button held) is unaffected.
 */
const AUTO_ADD_CAP_PER_WINDOW = 64;

/**
 * Service for managing Hue API users
 */
export class UserService {
  private readonly adapter: UserServiceAdapter;
  private readonly logger: Logger;

  /**
   * v1.4.3 (U2): in-memory mirror of paired client ids. Populated lazily on
   * first lookup, kept in sync by every `addUser`. Earlier every Hue API
   * request triggered `getStatesOfAsync("clients")`, hitting the broker on
   * every call — Echo polls the bridge frequently.
   */
  private clientIdsCache: Set<string> | null = null;

  /**
   * v1.4.3 (U1+R2): defense-in-depth counter for auto-added clients in the
   * current pairing window. Reset by {@link resetAutoAddBudget} which the
   * adapter calls when pairing flips on.
   */
  private autoAddedThisWindow = 0;
  private autoAddCapWarned = false;

  /**
   * Create a new user service
   *
   * @param config - User service configuration
   */
  constructor(config: UserServiceConfig) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }

  /**
   * Reset the auto-add counter — call when a new pairing window opens so
   * every press of the link button gets a fresh budget.
   */
  public resetAutoAddBudget(): void {
    this.autoAddedThisWindow = 0;
    this.autoAddCapWarned = false;
  }

  /**
   * Whether the auto-add cap for the current pairing window is exhausted.
   */
  public isAutoAddCapReached(): boolean {
    return this.autoAddedThisWindow >= AUTO_ADD_CAP_PER_WINDOW;
  }

  /**
   * Add a new client (Hue API "user").
   *
   * @param username Raw username (will be sanitized for the state id).
   * @param devicetype Client-supplied device type (purely informational).
   * @param viaAutoAdd `true` when called from the pairing-window auto-add
   *   path — counts against the per-window cap. `false` for explicit
   *   `POST /api` createUser calls (unbounded, gated by the link button).
   */
  public async addUser(username: string, devicetype = "unknown", viaAutoAdd = false): Promise<void> {
    if (viaAutoAdd) {
      if (this.autoAddedThisWindow >= AUTO_ADD_CAP_PER_WINDOW) {
        if (!this.autoAddCapWarned) {
          this.logger.warn(
            `Auto-add cap reached (${AUTO_ADD_CAP_PER_WINDOW} clients in this pairing window) — further unknown clients will be rejected until pairing is re-enabled`,
          );
          this.autoAddCapWarned = true;
        }
        throw new Error("Auto-add cap reached for this pairing window");
      }
      this.autoAddedThisWindow += 1;
    }

    const safeUsername = sanitizeId(username);
    this.logger.debug(`Creating client: ${safeUsername} (${devicetype})`);

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
      this.logger.warn(`Failed to create client object ${safeUsername}: ${errText(err)}`);
    }

    try {
      await this.adapter.setStateAsync(`clients.${safeUsername}`, {
        ack: true,
        val: username,
      });
    } catch (err) {
      this.logger.warn(`Failed to set client state ${safeUsername}: ${errText(err)}`);
    }

    // v1.4.3 (U2): keep the auth-cache fresh after every add
    if (this.clientIdsCache) {
      this.clientIdsCache.add(safeUsername);
    }
  }

  /**
   * Returns the set of paired client ids (sanitized form) for spec-compliant
   * `whitelist` exposure. Reuses the same lazy cache as the auth path.
   */
  public async listClientIds(): Promise<readonly string[]> {
    const cache = await this.ensureCache();
    return [...cache];
  }

  /**
   * Synchronous variant — returns whatever is currently cached (empty until
   * the first auth check populates it). Used in spots where async fanout
   * would force the caller to become async too (whitelist render-path).
   */
  public listCachedClientIds(): readonly string[] {
    return this.clientIdsCache ? [...this.clientIdsCache] : [];
  }

  /**
   * Create a new user with optional provided username
   *
   * @param providedUsername - Pre-defined username (generates UUID if empty)
   * @param devicetype - Client device type string
   */
  public async createUser(providedUsername?: string, devicetype = "unknown"): Promise<string> {
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
  public async isUserAuthenticated(username: string): Promise<boolean> {
    const safeUsername = sanitizeId(username);
    const cache = await this.ensureCache();
    const found = cache.has(safeUsername);
    if (found) {
      this.logger.debug(`Client authenticated: ${username}`);
    }
    return found;
  }

  /** Build (or return) the cache of sanitized client ids. */
  private async ensureCache(): Promise<Set<string>> {
    if (this.clientIdsCache) {
      return this.clientIdsCache;
    }
    const cache = new Set<string>();
    try {
      const stateObjects = (await this.adapter.getStatesOfAsync("clients", undefined)) || [];
      const offset = this.adapter.namespace.length + 1 + "clients.".length;
      for (const state of stateObjects) {
        const id = state._id.substring(offset);
        if (id) {
          cache.add(id);
        }
      }
    } catch (err) {
      this.logger.debug(`Could not load clients into cache: ${errText(err)}`);
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
  private async ensureClientsFolder(): Promise<void> {
    try {
      await this.adapter.setObjectNotExistsAsync("clients", {
        type: "meta",
        common: {
          name: tName("clientsFolder"),
          type: "meta.folder",
        },
        native: {},
      });
    } catch (err) {
      this.logger.warn(`Failed to create clients folder: ${errText(err)}`);
    }
  }
}
