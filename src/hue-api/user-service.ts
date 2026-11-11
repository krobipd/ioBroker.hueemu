/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";
import { errText } from "../lib/err-text";
import { oneLine } from "../types/utils";
import { CLIENTS_FILE, CLIENTS_FOLDER, clientNumberOf, type ClientStore } from "../lib/client-store";
import { clientCommon, nameText } from "../lib/client-move";

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
  setState(id: string, state: ioBroker.SettableState): Promise<unknown>;
  /** Get all state objects under a parent */
  getStatesOfAsync(parentDevice?: string, parentChannel?: string): Promise<ioBroker.StateObject[]>;
  /** Get the state values matching a pattern, keyed by full id */
  getStatesAsync(pattern: string): Promise<Record<string, ioBroker.State>>;
}

/**
 * User service configuration
 */
export interface UserServiceConfig {
  /** Adapter instance */
  adapter: UserServiceAdapter;
  /** Logger */
  logger: Logger;
  /** The client keys (clients.json), loaded before the first request. */
  store: ClientStore;
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
/** A provided username is stored for good (clients.json) — real bridges issue 40 chars. */
export const MAX_USERNAME_LENGTH = 64;
/** The devicetype is stored as the client object's display name. */
export const MAX_DEVICETYPE_LENGTH = 100;

/** What the whitelist shows for one paired client (times in ms since the epoch). */
export interface PairedClient {
  /** The device type the client paired with. */
  name: string;
  /** When it paired. */
  created: number;
  /** When it was last authenticated. */
  lastUse: number;
}

/**
 * Service for managing Hue API users
 */
export class UserService {
  private readonly adapter: UserServiceAdapter;
  private readonly logger: Logger;
  /** The number ↔ key table of the paired clients. */
  private readonly store: ClientStore;

  /**
   * v1.4.3 (U2): in-memory mirror of the paired clients. Populated lazily on
   * first lookup, kept in sync by every `addUser`. Earlier every Hue API
   * request triggered `getStatesOfAsync("clients")`, hitting the broker on
   * every call — Echo polls the bridge frequently.
   *
   * v1.17.0: it holds the REAL keys, never anything derived from them. Matching a
   * sanitized form meant every character a key holds that is not `[A-Za-z0-9-_]`
   * became a wildcard: a client paired as `living.room` also authenticated as
   * `living_room` and `living+room` (measured, audit 2026-09-06 F3). Since the
   * keys left the object tree (client-store.ts) an object id carries nothing of a
   * key at all — a key counts while its object `clients.<n>` exists AND
   * clients.json holds it for that number.
   */
  private clientKeysCache: Set<string> | null = null;

  /**
   * v1.18.0: the ONE broker read that fills the cache, shared by everyone who
   * arrives while it is in flight. Without it every request during a cold start
   * read the client list itself, and each answer replaced the cache with its own
   * snapshot: an answer that arrived late overwrote a cache another request had
   * meanwhile added a freshly paired client to — that client was then refused
   * until the next start (measured, audit 2026-09-15 B1).
   */
  private cacheLoad: Promise<Set<string>> | null = null;

  /**
   * v1.18.0: the `addUser` in flight per client key. A client's first burst of
   * parallel requests during pairing used to run the whole add path once per
   * request — and booked the auto-add budget and the hourly ceiling once per
   * request too (measured, audit 2026-09-15 B2). The second caller now simply
   * shares the first one's outcome.
   */
  private readonly pendingAdds: Map<string, Promise<void>> = new Map();

  /**
   * v1.19.0 (audit 2026-09-25 H5): what the whitelist shows per paired key — the
   * device type the client paired with, when it paired, when it was last seen. The
   * whitelist used to carry the key as its name and "now" as both dates.
   */
  private clientInfo: Map<string, PairedClient> = new Map();

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
    this.store = config.store;
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
   * @param username The client key (stored in clients.json, never in the tree).
   * @param devicetype Client-supplied device type (purely informational).
   * @param viaAutoAdd `true` when called from the pairing-window auto-add
   *   path — counts against the per-window cap. `false` for explicit
   *   `POST /api` createUser calls (gated by the link button and the hourly ceiling).
   */
  public addUser(username: string, devicetype = "unknown", viaAutoAdd = false): Promise<void> {
    const pending = this.pendingAdds.get(username);
    if (pending) {
      return pending;
    }
    const run = this.addUserOnce(username, devicetype, viaAutoAdd).finally(() => {
      this.pendingAdds.delete(username);
    });
    this.pendingAdds.set(username, run);
    return run;
  }

  /**
   * The add path proper — see {@link addUser} for the per-key in-flight guard.
   *
   * @param username - Username (real key) to add
   * @param devicetype - Device type string, stored as the object's display name
   * @param viaAutoAdd - True when this add was triggered by pairing-window auto-add
   */
  private async addUserOnce(username: string, devicetype: string, viaAutoAdd: boolean): Promise<void> {
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

    // v1.4.3 (U2): keep the auth-cache fresh after every add. Warmed BEFORE the
    // write since v1.15.0, because the ceiling has to tell a genuinely new
    // client from a client re-pairing under a name that already exists.
    const cache = await this.ensureCache();
    const isNewClient = !cache.has(username);
    const name = devicetype.slice(0, MAX_DEVICETYPE_LENGTH);

    // The key goes into clients.json first — synchronously, so two pairings at the
    // same moment can never take one number —, the object after it.
    let n: number;
    try {
      n = this.store.add(username);
    } catch (err) {
      this.logger.warn(`Failed to store the key of a new client in ${CLIENTS_FILE}: ${errText(err)}`);
      throw new Error("Client could not be stored");
    }
    const id = `${CLIENTS_FOLDER}.${n}`;
    this.logger.debug(`Creating client ${id} (${oneLine(name)})`);

    try {
      await this.adapter.setObjectNotExistsAsync(id, { type: "state", common: clientCommon(name), native: {} });
    } catch (err) {
      this.logger.warn(`Failed to create client object ${id}: ${errText(err)}`);
      if (isNewClient) {
        try {
          this.store.remove(n);
        } catch {
          // The next start forgets the key anyway — its object is missing.
        }
      }
      // v1.17.0: a pairing that did not reach the database is NOT a pairing.
      // It used to be reported as success and cached in memory, so the client
      // worked until the next adapter start and then lost access with no
      // explanation (measured, audit 2026-09-06 F2). The caller turns this into
      // Hue error 101, which every client answers by simply trying again.
      throw new Error("Client could not be stored");
    }

    // A client pairing again under its key changes nothing: its state keeps the
    // value and the last change of the first pairing — the pairing time the
    // whitelist shows (audit R-07; GV-05, audit R-33: a state is written only
    // when it changes).
    if (!isNewClient) {
      return;
    }
    try {
      await this.adapter.setState(id, { ack: true, val: name });
    } catch (err) {
      this.logger.warn(`Failed to set client state ${id}: ${errText(err)}`);
    }

    // Book against the hourly ceiling only for a client that is really new AND
    // really stored — the ceiling exists to bound the object database, so a
    // request that grew it by nothing must not consume a slot.
    this.countCreatedClient();
    // v1.17.0: the per-window auto-add budget is booked here too, for the same
    // reason the hourly ceiling moved in v1.15.0 — a failed write used to eat
    // one of the 64 slots (audit 2026-09-06 F12).
    if (viaAutoAdd) {
      this.autoAddedThisWindow += 1;
    }
    this.clientKeysCache?.add(username);
    const now = Date.now();
    this.clientInfo.set(username, { name, created: now, lastUse: now });
  }

  /**
   * Revoke a paired client whose object was deleted — v1.19.0 (audit 2026-09-25 H12):
   * the cache used to keep the key until the next adapter start, so deleting a client
   * in the admin did not lock it out. The key is the one clients.json holds for the
   * object's number (decision 22 — the real key, nothing derived from an id); the file
   * forgets it too, so the next start does not bring it back.
   *
   * @param objectSuffix The part of the object id after `clients.`
   */
  public forgetClient(objectSuffix: string): void {
    const n = clientNumberOf(objectSuffix);
    const key = n === undefined ? undefined : this.store.keyOf(n);
    if (n === undefined || key === undefined) {
      return;
    }
    try {
      this.store.remove(n);
    } catch (err) {
      this.logger.warn(
        `Could not store in ${CLIENTS_FILE} that ${CLIENTS_FOLDER}.${n} was removed (${errText(err)}) — it has no access now, and the next start forgets its key`,
      );
    }
    this.clientInfo.delete(key);
    const removed = this.clientKeysCache?.delete(key) ?? false;
    if (removed) {
      this.logger.info(`Client ${CLIENTS_FOLDER}.${n} removed — it has no access any more`);
    }
  }

  /**
   * The paired clients as the whitelist lists them — key, device type, pairing and
   * last-use time (ms). Empty until the first auth check has loaded the cache.
   */
  public listPairedClients(): readonly (PairedClient & { key: string })[] {
    // Synchronous on purpose so the whitelist render path (config-service) needn't
    // become async — empty until the first auth check has loaded the cache.
    return [...(this.clientKeysCache ?? [])].map(key => {
      const info = this.clientInfo.get(key);
      return { key, name: info?.name ?? key, created: info?.created ?? 0, lastUse: info?.lastUse ?? 0 };
    });
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
      const info = this.clientInfo.get(username);
      if (info) {
        info.lastUse = Date.now();
      }
    }
    return found;
  }

  /**
   * Build (or return) the cache of paired client keys: the key clients.json holds
   * for each client object `clients.<n>` that exists.
   */
  private ensureCache(): Promise<Set<string>> {
    if (this.clientKeysCache) {
      return Promise.resolve(this.clientKeysCache);
    }
    // One read for everyone waiting — see {@link cacheLoad}.
    this.cacheLoad ??= this.loadCache().finally(() => {
      this.cacheLoad = null;
    });
    return this.cacheLoad;
  }

  /**
   * The client state values, for their pairing time. A failed read costs only the
   * dates — authentication never depends on it.
   */
  private async readClientValues(): Promise<Record<string, ioBroker.State | null | undefined>> {
    try {
      return (await this.adapter.getStatesAsync(`${CLIENTS_FOLDER}.*`)) ?? {};
    } catch (err) {
      this.logger.debug(`Could not read the client states for their pairing time: ${errText(err)}`);
      return {};
    }
  }

  /**
   * Read the paired clients from the broker into the cache.
   */
  private async loadCache(): Promise<Set<string>> {
    const cache = new Set<string>();
    const info = new Map<string, PairedClient>();
    try {
      const stateObjects = (await this.adapter.getStatesOfAsync(CLIENTS_FOLDER, undefined)) || [];
      const values = await this.readClientValues();
      const offset = this.adapter.namespace.length + 1 + CLIENTS_FOLDER.length + 1;
      for (const state of stateObjects) {
        const n = clientNumberOf(state._id.substring(offset));
        // A key counts only while its object exists AND clients.json holds it — a
        // file entry alone never signs in, so deleting the object revokes.
        const key = n === undefined ? undefined : this.store.keyOf(n);
        if (key === undefined) {
          continue;
        }
        cache.add(key);
        // The pairing time is the client state's last change: its value is the device
        // type, written once at pairing and never changed, and js-controller moves `lc`
        // only when the value changes (db-states-redis 7.2.5 statesInRedisClient). The
        // object's own `ts` moves with every object write — a name refresh, a rename
        // in the admin — and is only the fallback (audit R-07). Nothing extra is
        // stored: a timestamp in the tree would make every object inventory differ.
        const lc = values[state._id]?.lc;
        const created = typeof lc === "number" ? lc : typeof state.ts === "number" ? state.ts : Date.now();
        info.set(key, { name: nameText(state.common?.name, key), created, lastUse: created });
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
    this.clientInfo = info;
    return cache;
  }
}
