/**
 * The keys of the paired Hue clients — a file in the instance data folder — and the ids of their objects.
 *
 * Up to v1.19.0 a client's key was its object id (`clients.<key>`), its `native.username` and its state value — a
 * 36-character text nobody can read. krobi 2026-11-11 14:25 ("this value is far too long, make me a proposal based on
 * the fleet standard") and 14:27 ("yes, that sounds good"): a client object is named like the fleet
 * names a device — the model it pairs as, a hyphen and the last four characters of its own number, its key
 * (`clients.harmony-hub-ac37`). The key itself stands in this file, which maps each id to its key — an access key is a
 * secret (B02 `audit_own_native_at_runtime`, krobi 2026-11-05 22:46: secrets as a file in the instance data folder).
 *
 * The id is handed out once and never derived again: renaming the object changes its name, not its id, and a lookup
 * goes through this file, never through the device type. Two clients of one model with the same four characters get a
 * counter (`-2`, `-3` …) — the fleet takes the whole unit number there, which here would be the key.
 *
 * The object stays the truth of "paired": a key counts only while its object exists (user-service.ts), so deleting the
 * object revokes the client — also while the adapter is stopped (decision 31). A file that cannot be read is never
 * taken for an empty one — it is set aside before the next write, so nothing it holds is overwritten.
 */

import { readDataFile, setAsideDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const CLIENTS_FILE = "clients.json";

/** Where an unreadable file is moved before a new one is written. */
export const UNREADABLE_CLIENTS_FILE = `${CLIENTS_FILE}.unreadable`;

/** The folder of the client objects. */
export const CLIENTS_FOLDER = "clients";

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
  private keys = new Map<string, string>();
  /** Ids an object below `clients.` holds without an entry here — never handed out. */
  private readonly reserved = new Set<string>();
  /** Why the file could not be read at the last load — it is set aside before the next write. */
  private unreadable: string | undefined;

  /**
   * @param dir the instance data folder
   */
  public constructor(dir: string) {
    this.dir = dir;
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
    const read = readDataFile(this.dir, CLIENTS_FILE);
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
      for (const [id, key] of Object.entries(clients)) {
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
    writeDataFile(this.dir, CLIENTS_FILE, { clients });
  }
}
