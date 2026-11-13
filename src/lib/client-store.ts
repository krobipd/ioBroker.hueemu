/**
 * The keys of the paired Hue clients — a file in the instance data folder — and the ids of their objects.
 *
 * Up to v1.19.0 a client's key was its object id (`clients.<key>`), its `native.username` and its state value — a
 * 36-character text nobody can read. krobi 2026-11-11 14:25 ("this value is far too long, make me a proposal based on
 * the fleet standard") and 14:27 ("yes, that sounds good"): a client object is named like the fleet
 * names a device — the model it pairs as, a hyphen and the last four characters of its own number, its key
 * (`clients.harmony-hub-ac37`). The key itself stands in this file, which maps each id to its key — an access key is a
 * secret (B02 `audit_own_native_at_runtime`, krobi 2026-11-05 22:46: secrets as a file in the instance data folder),
 * stored encrypted by the fleet master under the field {@link KEY_FIELD} (CLAUDE_PATTERNS.md, Geheimnisse S3/S7, round
 * 174): `{ "clients": { "<id>": { "apiKey": { "$encrypted": … } } } }`.
 *
 * The id is handed out once and never derived again: renaming the object changes its name, not its id, and a lookup
 * goes through this file, never through the device type. Two clients of one model with the same four characters get a
 * counter (`-2`, `-3` …) — the fleet takes the whole unit number there, which here would be the key.
 *
 * The object stays the truth of "paired": a key counts only while its object exists (user-service.ts), so deleting the
 * object revokes the client — also while the adapter is stopped (decision 31). A file that cannot be read is never
 * taken for an empty one — it is set aside before the next write, so nothing it holds is overwritten.
 */

import { type DataFileCipher, type DataFileSecrets, readDataFile, setAsideDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const CLIENTS_FILE = "clients.json";

/** The field of an entry that holds the key — a name the fleet's word list knows as a secret (S7: `^.*api.?key$`). */
export const KEY_FIELD = "apiKey";

/** Where an unreadable file is moved before a new one is written. */
export const UNREADABLE_CLIENTS_FILE = `${CLIENTS_FILE}.unreadable`;

/** The folder of the client objects. */
export const CLIENTS_FOLDER = "clients";

/** The folder the clients lived in before v1.2.0. */
export const LEGACY_USER_FOLDER = "user";

/** The device type the adapter puts in for a client that names none (`POST /api` without one, an old object). */
export const UNKNOWN_DEVICETYPE = "unknown";

/** The device type of a client taken in by the pairing window without a `POST /api` — it named nothing. */
export const AUTO_PAIRED_DEVICETYPE = "auto-paired";

/** The model part of the id of a client that names no device type. */
export const CLIENT_MODEL_FALLBACK = "client";

/** How many trailing letters and digits of the key the id carries. */
const KEY_TAIL = 4;

/** The adapter's own words for "no device type" — never a model. */
const PLACEHOLDER_DEVICETYPES: ReadonlySet<string> = new Set([UNKNOWN_DEVICETYPE, AUTO_PAIRED_DEVICETYPE]);

/**
 * A text as an id part: lower case, umlauts written out, accents dropped, every run of anything but letters and
 * digits one hyphen, none at either end — empty when nothing is left. The fleet's form (homeconnect `slugOf`).
 *
 * @param text the text
 */
export function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The model half of a client id: the device type it paired with as an id part, `client` when it named none.
 *
 * @param devicetype the device type (type guard at the boundary: anything)
 */
export function clientModel(devicetype: unknown): string {
  if (typeof devicetype !== "string" || PLACEHOLDER_DEVICETYPES.has(devicetype.trim())) {
    return CLIENT_MODEL_FALLBACK;
  }
  const slug = slugOf(devicetype.trim());
  return slug.length > 0 ? slug : CLIENT_MODEL_FALLBACK;
}

/**
 * The id a new client gets: its model and the last four letters or digits of its key (`harmony-hub-ac37`), the model
 * alone when the key has none; a counter when another client holds that id already.
 *
 * @param devicetype the device type it paired with
 * @param key its key
 * @param taken the ids other clients hold
 */
export function clientIdFor(devicetype: unknown, key: string, taken: ReadonlySet<string>): string {
  const model = clientModel(devicetype);
  const tail = key
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase()
    .slice(-KEY_TAIL);
  const base = tail.length > 0 ? `${model}-${tail}` : model;
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${n}`;
  }
  return id;
}

/** How many trailing characters of a key a log line shows when no paired client holds it. */
const LOG_KEY_TAIL = 4;

/**
 * A client key as a log line names it — never whole (H-06, krobi 2026-11-11: the key stands only in a file in the
 * instance data folder): the object id of the paired client that holds it, else its last four characters behind an
 * ellipsis; of a key that short nothing.
 *
 * @param key the key
 * @param id the id of the client that holds it, undefined when none does
 */
export function keyForLog(key: string, id: string | undefined): string {
  if (id !== undefined) {
    return `${CLIENTS_FOLDER}.${id}`;
  }
  return key.length > LOG_KEY_TAIL ? `…${key.slice(-LOG_KEY_TAIL)}` : "…";
}

/** The key part of a request URL: `/api/<key>/…`. */
const API_KEY = /^(\/api\/)([^/?#]+)/i;

/** The one Hue path that names a second key: a whitelist entry (`DELETE /api/<key>/config/whitelist/<key>`). */
const WHITELIST_ENTRY = /(\/config\/whitelist\/)([^/?#]+)/gi;

/**
 * A request URL as a log line names it: the key part of `/api/<key>/…` and a whitelist entry as `nameOf` names them.
 * The public `/api/config` (decision 10) and every other path stay as they are.
 *
 * @param url the request URL
 * @param nameOf how a key is named in a log line
 */
export function urlForLog(url: string, nameOf: (key: string) => string): string {
  return url
    .replace(API_KEY, (whole: string, api: string, key: string) =>
      key.toLowerCase() === "config" ? whole : `${api}${nameOf(key)}`,
    )
    .replace(WHITELIST_ENTRY, (_whole: string, path: string, key: string) => `${path}${nameOf(key)}`);
}

/**
 * A text about a request — an error message that repeats part of its path — as a log line names it: every key the
 * request's URL carries ({@link urlForLog}), wherever the text repeats it, as `nameOf` names it.
 *
 * @param text the text
 * @param url the request URL
 * @param nameOf how a key is named in a log line
 */
export function textForLog(text: string, url: string, nameOf: (key: string) => string): string {
  const keys = [...url.matchAll(WHITELIST_ENTRY)].map(match => match[2]);
  const api = API_KEY.exec(url);
  if (api && api[2].toLowerCase() !== "config") {
    keys.push(api[2]);
  }
  return keys.sort((a, b) => b.length - a.length).reduce((named, key) => named.split(key).join(nameOf(key)), text);
}

/**
 * An own object id as a log line names it. Below `clients.` and the `user.` folder of versions before v1.2.0, an id
 * the table holds stays as it is; any other — an object of an earlier version, whose id was the key — shows only its
 * last four characters ({@link keyForLog}, H-06). Every id outside them stays as it is.
 *
 * @param id the full object id
 * @param namespace the adapter's namespace (`hueemu.0`)
 * @param store the client table, undefined before it is loaded
 */
export function objectIdForLog(id: string, namespace: string, store: Pick<ClientStore, "keyOf"> | undefined): string {
  for (const folder of [CLIENTS_FOLDER, LEGACY_USER_FOLDER]) {
    const prefix = `${namespace}.${folder}.`;
    if (id.startsWith(prefix)) {
      const suffix = id.slice(prefix.length);
      return store?.keyOf(suffix) !== undefined ? id : `${prefix}${keyForLog(suffix, undefined)}`;
    }
  }
  return id;
}

/**
 * Whether a text is a client id of the current form: lower-case letters and digits joined by hyphens.
 *
 * @param suffix the part of an object id after `clients.`
 */
export function isClientId(suffix: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(suffix);
}

/** The id ↔ key table of the paired clients, read from and written to {@link CLIENTS_FILE}. */
export class ClientStore {
  private readonly dir: string;
  private readonly secrets: DataFileSecrets;
  private keys = new Map<string, string>();
  /** Ids an object below `clients.` holds without an entry here — never handed out. */
  private readonly reserved = new Set<string>();
  /** Why the file could not be read at the last load — it is set aside before the next write. */
  private unreadable: string | undefined;

  /**
   * @param dir the instance data folder
   * @param cipher encrypts and decrypts the keys — the adapter instance
   */
  public constructor(dir: string, cipher: DataFileCipher) {
    this.dir = dir;
    this.secrets = { cipher, fields: [KEY_FIELD] };
  }

  /**
   * Read the file. Nothing there is an empty table; a file that cannot be used leaves the table empty as well, but is
   * kept until the next write sets it aside.
   *
   * @returns why the file cannot be used, undefined when it can (or is not there yet)
   */
  public load(): string | undefined {
    this.keys = new Map();
    this.unreadable = undefined;
    const read = readDataFile(this.dir, CLIENTS_FILE, this.secrets);
    if (read.error !== undefined) {
      this.unreadable = read.error;
      return read.error;
    }
    if (read.value === undefined) {
      return undefined;
    }
    // Type guards at the boundary: the file can be edited by hand.
    const data = read.value;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      this.unreadable = "no table in it";
      return this.unreadable;
    }
    const { clients } = data as Record<string, unknown>;
    if (typeof clients === "object" && clients !== null && !Array.isArray(clients)) {
      for (const [id, entry] of Object.entries(clients)) {
        const key =
          typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)[KEY_FIELD] : undefined;
        if (isClientId(id) && typeof key === "string" && key) {
          this.keys.set(id, key);
        }
      }
    }
    return undefined;
  }

  /** Whether the last load could read the file (or found none). */
  public get readable(): boolean {
    return this.unreadable === undefined;
  }

  /**
   * The key stored for a client id.
   *
   * @param id the client id (the part after `clients.`)
   */
  public keyOf(id: string): string | undefined {
    return this.keys.get(id);
  }

  /**
   * The id stored for a key.
   *
   * @param key the client key
   */
  public idOf(key: string): string | undefined {
    for (const [id, stored] of this.keys) {
      if (stored === key) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * A key as a log line names it — the id of its client, else its last four characters ({@link keyForLog}).
   *
   * @param key the client key
   */
  public forLog(key: string): string {
    return keyForLog(key, this.idOf(key));
  }

  /** Every stored id, sorted. */
  public ids(): string[] {
    return [...this.keys.keys()].sort();
  }

  /**
   * Keep ids the tree holds from being handed out — an object without an entry here (its file was lost) or an old
   * object the move is about to delete: a new client must neither take over the first nor be deleted with the second.
   *
   * @param ids the ids below `clients.`
   */
  public reserve(ids: Iterable<string>): void {
    for (const id of ids) {
      this.reserved.add(id);
    }
  }

  /**
   * The id of a key — the stored one, or a new one from the device type, stored together with the key before this
   * returns. Synchronous on purpose: two pairings at the same moment can never take the same id. Throws when the file
   * cannot be written; the table is then as it was.
   *
   * @param key the client key
   * @param devicetype the device type it paired with
   * @returns the client id
   */
  public add(key: string, devicetype: unknown): string {
    const known = this.idOf(key);
    if (known !== undefined) {
      return known;
    }
    const id = clientIdFor(devicetype, key, new Set([...this.keys.keys(), ...this.reserved]));
    this.keys.set(id, key);
    try {
      this.write();
    } catch (err) {
      this.keys.delete(id);
      throw err;
    }
    return id;
  }

  /**
   * Forget the key of a client id and store that. The table forgets it even when the file cannot be written — the
   * next start drops it again, because its object is gone.
   *
   * @param id the client id
   * @returns the key it held, undefined when it held none
   */
  public remove(id: string): string | undefined {
    const key = this.keys.get(id);
    if (key === undefined) {
      return undefined;
    }
    this.keys.delete(id);
    this.write();
    return key;
  }

  /**
   * Forget every key whose object is gone — deleted while the adapter was stopped — and store that once.
   *
   * @param present the client ids whose object exists
   * @returns how many keys were forgotten
   */
  public keepOnly(present: ReadonlySet<string>): number {
    const gone = this.ids().filter(id => !present.has(id));
    for (const id of gone) {
      this.keys.delete(id);
    }
    if (gone.length > 0) {
      this.write();
    }
    return gone.length;
  }

  /** Store the table — an unreadable file is moved aside first, never overwritten. */
  private write(): void {
    if (this.unreadable !== undefined) {
      setAsideDataFile(this.dir, CLIENTS_FILE, UNREADABLE_CLIENTS_FILE);
      this.unreadable = undefined;
    }
    const clients: Record<string, string> = {};
    for (const id of this.ids()) {
      clients[id] = this.keys.get(id) as string;
    }
    // Each key under its named field, so the master stores it encrypted (S7).
    const entries = Object.fromEntries(Object.entries(clients).map(([id, key]) => [id, { [KEY_FIELD]: key }]));
    writeDataFile(this.dir, CLIENTS_FILE, { clients: entries }, this.secrets);
  }
}
