/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";
import { tName, tRaw } from "../lib/i18n";
import { errText, oneLine, sanitizeId } from "../types/utils";

/**
 * Adapter interface for user service
 */
export interface UserServiceAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** ioBroker logger */
  log: ioBroker.Logger;
  /** Create an object if it does not exist */
  setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): Promise<unknown>;
  /** Set a state value */
  setStateAsync(id: string, state: ioBroker.SettableState): Promise<unknown>;
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
}

/**
 * v1.4.3 (U1+R2): cap on auto-added clients within a single pairing window.
 * The auto-add path in `ApiHandler.isUserAuthenticated` accepts any unknown
 * username during the 50 s pairing window — necessary for Echo/Harmony
 * compatibility, but a misbehaving (or hostile) client could create
 * thousands of permanent client records over those seconds. Real Hue
 * bridges press only one pair per button-press; we keep the auto-add for
 * compat but cap the total per window. Manual `createUser` (POST /api with
 * the link button held) is not counted here — the hourly ceiling below bounds
 * it together with every other path.
 */
const AUTO_ADD_CAP_PER_WINDOW = 64;

/**
 * Ceiling on persistent client creations per hour, over every path (manual
 * POST /api and auto-add). The per-window auto-add cap does not cover
 * POST /api, and with `disableAuth` on that path has no link-button gate
 * either — without a ceiling one device could grow the object DB without
 * bound (one object + one state per request). Legitimate use pairs a handful
 * of clients over the lifetime of an install; 100 in one hour is only ever a
 * flood.
 */
export const CLIENT_CREATE_CEILING_PER_HOUR = 100;
const CLIENT_CREATE_WINDOW_MS = 60 * 60 * 1000;
/** A provided username becomes a persistent object id — real bridges issue 40 chars. */
export const MAX_USERNAME_LENGTH = 64;
/** The devicetype is stored as the client object's display name. */
export const MAX_DEVICETYPE_LENGTH = 100;

/**
 * Service for managing Hue API users
 */
export class UserService {
  private readonly adapter: UserServiceAdapter;
  private readonly logger: Logger;

  /**
   * v1.4.3 (U2): in-memory mirror of the paired clients. Populated lazily on
   * first lookup, kept in sync by every `addUser`. Earlier every Hue API
   * request triggered `getStatesOfAsync("clients")`, hitting the broker on
   * every call — Echo polls the bridge frequently.
   *
   * v1.17.0: it holds the REAL keys, not the sanitized object ids. Matching the
   * sanitized form meant every character a key holds that is not `[A-Za-z0-9-_]`
   * became a wildcard: a client paired as `living.room` also authenticated as
   * `living_room` and `living+room` (measured, audit 2026-09-06 F3). The object
   * id still has to be sanitized — it is an ioBroker id — so the two are kept
   * apart on purpose.
   */
  private clientKeysCache: Set<string> | null = null;

  /**
   * Which real key owns which sanitized object id. Two different keys can
   * sanitize to the same id; the second one would silently take over the first
   * one's object, so it is refused instead.
   */
  private idOwners: Map<string, string> = new Map();

  /**
   * v1.4.3 (U1+R2): defense-in-depth counter for auto-added clients in the
   * current pairing window. Reset by {@link resetAutoAddBudget} which the
   * adapter calls when pairing flips on.
   */
  private autoAddedThisWindow = 0;
  private autoAddCapWarned = false;

  /** Fixed hourly window for {@link CLIENT_CREATE_CEILING_PER_HOUR}; starts with the first creation. */
  private createWindow = { startedAt: 0, count: 0, warned: false };

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
  private enforceCreateCeiling(): void {
    const now = Date.now();
    if (now - this.createWindow.startedAt >= CLIENT_CREATE_WINDOW_MS) {
      this.createWindow = { startedAt: now, count: 0, warned: false };
    }
    if (this.createWindow.count >= CLIENT_CREATE_CEILING_PER_HOUR) {
      if (!this.createWindow.warned) {
        this.createWindow.warned = true;
        this.logger.warn(
          `Client creation ceiling reached (${CLIENT_CREATE_CEILING_PER_HOUR} new clients within one hour) — further pairing requests are rejected until the hour is over (a misbehaving client, or disableAuth on an untrusted network?)`,
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
  private countCreatedClient(): void {
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
  public async addUser(username: string, devicetype = "unknown", viaAutoAdd = false): Promise<void> {
    // Every path — the ceiling is what bounds the object DB when nothing else does.
    this.enforceCreateCeiling();

    if (viaAutoAdd && this.autoAddedThisWindow >= AUTO_ADD_CAP_PER_WINDOW) {
      if (!this.autoAddCapWarned) {
        this.logger.warn(
          `Auto-add cap reached (${AUTO_ADD_CAP_PER_WINDOW} clients in this pairing window) — further unknown clients will be rejected until pairing is re-enabled`,
        );
        this.autoAddCapWarned = true;
      }
      throw new Error("Auto-add cap reached for this pairing window");
    }

    const safeUsername = sanitizeId(username);
    this.logger.debug(`Creating client: ${safeUsername} (${oneLine(devicetype)})`);

    // v1.4.3 (U2): keep the auth-cache fresh after every add. Warmed BEFORE the
    // write since v1.15.0, because the ceiling has to tell a genuinely new
    // client from a client re-pairing under a name that already exists.
    const cache = await this.ensureCache();
    const isNewClient = !cache.has(username);

    // Two different keys can sanitize to the same object id. Letting the second
    // one through would hand it the first one's object — and its access.
    const owner = this.idOwners.get(safeUsername);
    if (owner !== undefined && owner !== username) {
      this.logger.warn(
        `Refusing client "${oneLine(username)}": its object id "${safeUsername}" already belongs to another paired client`,
      );
      throw new Error("Client id already taken by another key");
    }

    // Ensure clients folder exists
    await this.ensureClientsFolder();

    let persisted = false;

    // Create client state (sanitizeId: FORBIDDEN_CHARS compliance)
    try {
      await this.adapter.setObjectNotExistsAsync(`clients.${safeUsername}`, {
        type: "state",
        common: {
          // A translation object, not a bare string — `common.name` is one for
          // EVERY object type, even where the text comes from the device and has
          // nothing to translate (core team, nut2 #15). Measured on the live tree
          // 2026-09-03: the two paired clients carried bare strings.
          name: tRaw(devicetype.slice(0, MAX_DEVICETYPE_LENGTH)),
          desc: tName("clientDesc"),
          type: "string",
          role: "text",
          read: true,
          write: false,
        },
        native: { username },
      });
      persisted = true;
    } catch (err) {
      this.logger.warn(`Failed to create client object ${safeUsername}: ${errText(err)}`);
    }

    if (!persisted) {
      // v1.17.0: a pairing that did not reach the database is NOT a pairing.
      // It used to be reported as success and cached in memory, so the client
      // worked until the next adapter start and then lost access with no
      // explanation (measured, audit 2026-09-06 F2). The caller turns this into
      // Hue error 101, which every client answers by simply trying again.
      throw new Error("Client could not be stored");
    }

    try {
      await this.adapter.setStateAsync(`clients.${safeUsername}`, {
        ack: true,
        val: username,
      });
    } catch (err) {
      this.logger.warn(`Failed to set client state ${safeUsername}: ${errText(err)}`);
    }

    // Book against the hourly ceiling only for a client that is really new AND
    // really stored — the ceiling exists to bound the object database, so a
    // request that grew it by nothing must not consume a slot.
    if (isNewClient) {
      this.countCreatedClient();
    }
    // v1.17.0: the per-window auto-add budget is booked here too, for the same
    // reason the hourly ceiling moved in v1.15.0 — a failed write used to eat
    // one of the 64 slots (audit 2026-09-06 F12).
    if (viaAutoAdd && isNewClient) {
      this.autoAddedThisWindow += 1;
    }
    this.clientKeysCache?.add(username);
    this.idOwners.set(safeUsername, username);
  }

  /**
   * Returns the paired client keys currently in the cache — empty until the
   * first auth check populates it. Synchronous on purpose so the whitelist
   * render-path (config-service) needn't become async. Since v1.17.0 these are
   * the real keys, which is also what a Hue whitelist is supposed to list.
   */
  public listCachedClientIds(): readonly string[] {
    return this.clientKeysCache ? [...this.clientKeysCache] : [];
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
    const cache = await this.ensureCache();
    // The REAL key, not its sanitized object id — see {@link clientKeysCache}.
    const found = cache.has(username);
    if (found) {
      this.logger.debug(`Client authenticated: ${oneLine(username)}`);
    }
    return found;
  }

  /**
   * Build (or return) the cache of paired client keys.
   *
   * The key is `native.username`, which every client object has carried since
   * the object was introduced. Only an object from before that — or one a user
   * built by hand — falls back to its own id, which for a generated UUID key is
   * the same string anyway.
   */
  private async ensureCache(): Promise<Set<string>> {
    if (this.clientKeysCache) {
      return this.clientKeysCache;
    }
    const cache = new Set<string>();
    const owners = new Map<string, string>();
    try {
      const stateObjects = (await this.adapter.getStatesOfAsync("clients", undefined)) || [];
      const offset = this.adapter.namespace.length + 1 + "clients.".length;
      for (const state of stateObjects) {
        const id = state._id.substring(offset);
        if (!id) {
          continue;
        }
        const stored = (state.native as { username?: unknown } | undefined)?.username;
        const key = typeof stored === "string" && stored ? stored : id;
        cache.add(key);
        owners.set(id, key);
      }
    } catch (err) {
      // Do NOT cache on failure: caching the empty set here would permanently
      // reject every already-paired client until the adapter restarts (a single
      // transient broker error poisons auth). Leave the cache null so the next
      // lookup retries the broker.
      this.logger.warn(`Could not load clients into cache, retrying on next request: ${errText(err)}`);
      return cache;
    }
    this.clientKeysCache = cache;
    this.idOwners = owners;
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
        type: "folder",
        common: {
          name: tName("clientsFolder"),
          desc: tName("clientsFolderDesc"),
        },
        native: {},
      });
    } catch (err) {
      this.logger.warn(`Failed to create clients folder: ${errText(err)}`);
    }
  }
}
