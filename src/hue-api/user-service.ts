/**
 * User/Authentication Service for Hue API
 */

import * as uuid from "uuid";
import type { Logger } from "../types/config";
import { errText } from "../lib/err-text";
import { oneLine } from "../types/utils";
import { CLIENTS_FILE, CLIENTS_FOLDER, UNKNOWN_DEVICETYPE, type ClientStore } from "../lib/client-store";
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

/*
 * No limit for pairings (decision K6, krobi 2026-11-10 16:10: "who on earth will ever pair 100 Harmonies", accepted
 * 2026-11-11 07:37), and every device that asks inside the pairing window gets access (K3). Up to 1.19.0 a ceiling of
 * 100 new clients an hour and a cap of 64 auto-added clients a window refused the rest — not again: K6 and K3 decide
 * it, and the window itself is the gate.
 */

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
  /** The id ↔ key table of the paired clients. */
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
   * keys left the object tree (client-store.ts) an object id carries at most the
   * last four characters of a key — a key counts while its object
   * `clients.<id>` exists AND clients.json holds it for that id.
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
   * request (measured, audit 2026-09-15 B2). The second caller now simply
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
   * Add a new client (Hue API "user") — from the pairing-window auto-add or from
   * `POST /api` (gated by the link button).
   *
   * @param username The client key (stored in clients.json, never in the tree).
   * @param devicetype Client-supplied device type (purely informational).
   */
  public addUser(username: string, devicetype = UNKNOWN_DEVICETYPE): Promise<void> {
    const pending = this.pendingAdds.get(username);
    if (pending) {
      return pending;
    }
    const run = this.addUserOnce(username, devicetype).finally(() => {
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
   */
  private async addUserOnce(username: string, devicetype: string): Promise<void> {
    // v1.4.3 (U2): keep the auth-cache fresh after every add. Warmed BEFORE the
    // write, because a genuinely new client is told from a client re-pairing
    // under a name that already exists: only the new one gets its state written.
    const cache = await this.ensureCache();
    const isNewClient = !cache.has(username);
    const name = devicetype.slice(0, MAX_DEVICETYPE_LENGTH);

    // The key goes into clients.json first — synchronously, so two pairings at the
    // same moment can never take one id —, the object after it. A client pairing
    // again gets the id it holds, whatever device type it names now.
    let clientId: string;
    try {
      clientId = this.store.add(username, name);
    } catch (err) {
      this.logger.warn(`Failed to store the key of a new client in ${CLIENTS_FILE}: ${errText(err)}`);
      throw new Error("Client could not be stored");
    }
    const id = `${CLIENTS_FOLDER}.${clientId}`;
    this.logger.debug(`Creating client ${id} (${oneLine(name)})`);

    try {
      await this.adapter.setObjectNotExistsAsync(id, { type: "state", common: clientCommon(name), native: {} });
    } catch (err) {
      this.logger.warn(`Failed to create client object ${id}: ${errText(err)}`);
      if (isNewClient) {
        try {
          this.store.remove(clientId);
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

    this.clientKeysCache?.add(username);
    const now = Date.now();
    this.clientInfo.set(username, { name, created: now, lastUse: now });
  }

  /**
   * Revoke a paired client whose object was deleted — v1.19.0 (audit 2026-09-25 H12):
   * the cache used to keep the key until the next adapter start, so deleting a client
   * in the admin did not lock it out. The key is the one clients.json holds for the
   * object's id (decision 22 — the real key, nothing derived from an id); the file
   * forgets it too, so the next start does not bring it back.
   *
   * @param objectSuffix The part of the object id after `clients.`
   */
  public forgetClient(objectSuffix: string): void {
    const key = this.store.keyOf(objectSuffix);
    if (key === undefined) {
      return;
    }
    try {
      this.store.remove(objectSuffix);
    } catch (err) {
      this.logger.warn(
        `Could not store in ${CLIENTS_FILE} that ${CLIENTS_FOLDER}.${objectSuffix} was removed (${errText(err)}) — it has no access now, and the next start forgets its key`,
      );
    }
    this.clientInfo.delete(key);
    const removed = this.clientKeysCache?.delete(key) ?? false;
    if (removed) {
      this.logger.info(`Client ${CLIENTS_FOLDER}.${objectSuffix} removed — it has no access any more`);
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
  public async createUser(providedUsername?: string, devicetype = UNKNOWN_DEVICETYPE): Promise<string> {
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
      this.logger.debug(`Client authenticated: ${oneLine(this.store.forLog(username))}`);
      const info = this.clientInfo.get(username);
      if (info) {
        info.lastUse = Date.now();
      }
    }
    return found;
  }

  /**
   * Build (or return) the cache of paired client keys: the key clients.json holds
   * for each client object `clients.<id>` that exists.
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
        // A key counts only while its object exists AND clients.json holds it — a
        // file entry alone never signs in, so deleting the object revokes.
        const key = this.store.keyOf(state._id.substring(offset));
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
