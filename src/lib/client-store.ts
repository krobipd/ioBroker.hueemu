/**
 * The keys of the paired Hue clients — a file in the instance data folder, never the object tree.
 *
 * Werkbank standard of round 173 (point 4 and its addendum, CLAUDE_PATTERNS.md § native „Wohin“: "Ein erzeugtes
 * Geheimnis (Zertifikat, Schlüssel, Zugangsdaten) als Datei im Datenordner der Instanz"): a generated secret stands only
 * in that file — never in an object id, never in `common` or `native`. Up to v1.19.0 a client's key was its object id
 * (`clients.<key>`), its `native.username` and its state value. A client object is now `clients.<n>`, and this file maps
 * the number to the key.
 *
 * The object stays the truth of "paired": a key counts only while its object exists (user-service.ts), so deleting the
 * object revokes the client — also while the adapter is stopped (decision 31).
 *
 * A number is never handed out twice (the mark): a new pairing would otherwise inherit the room, the function and the
 * recording of a deleted one. A file that cannot be read is never taken for an empty one — it is set aside before the
 * next write, so nothing it holds is overwritten.
 */

import { readDataFile, setAsideDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const CLIENTS_FILE = "clients.json";

/** Where an unreadable file is moved before a new one is written. */
export const UNREADABLE_CLIENTS_FILE = `${CLIENTS_FILE}.unreadable`;

/** The folder of the client objects. */
export const CLIENTS_FOLDER = "clients";

/**
 * A client number: a positive whole number.
 *
 * @param value anything
 */
export function isClientNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * The client number of an object id below `clients.`, undefined for any other id.
 *
 * @param suffix the part of the id after `clients.`
 */
export function clientNumberOf(suffix: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(suffix)) {
    return undefined;
  }
  const n = Number(suffix);
  return isClientNumber(n) ? n : undefined;
}

/** The number ↔ key table of the paired clients, read from and written to {@link CLIENTS_FILE}. */
export class ClientStore {
  private readonly dir: string;
  private keys = new Map<number, string>();
  /** The highest number ever handed out. */
  private mark = 0;
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
    this.mark = 0;
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
    const { clients, lastClientId } = data as Record<string, unknown>;
    if (typeof clients === "object" && clients !== null && !Array.isArray(clients)) {
      for (const [suffix, key] of Object.entries(clients)) {
        const n = clientNumberOf(suffix);
        if (n !== undefined && typeof key === "string" && key) {
          this.keys.set(n, key);
        }
      }
    }
    this.mark = Math.max(isClientNumber(lastClientId) ? lastClientId : 0, ...this.keys.keys());
    return undefined;
  }

  /** Whether the last load could read the file (or found none). */
  public get readable(): boolean {
    return this.unreadable === undefined;
  }

  /**
   * The key stored for a client number.
   *
   * @param n the client number
   */
  public keyOf(n: number): string | undefined {
    return this.keys.get(n);
  }

  /**
   * The number stored for a key.
   *
   * @param key the client key
   */
  public numberOf(key: string): number | undefined {
    for (const [n, stored] of this.keys) {
      if (stored === key) {
        return n;
      }
    }
    return undefined;
  }

  /** Every stored number, ascending. */
  public numbers(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }

  /**
   * Raise the mark to numbers seen in the tree — taken with the next write. Only matters when the file was lost or
   * unreadable: every number this store hands out raises the mark itself.
   *
   * @param numbers the client numbers in the tree
   */
  public raiseMark(numbers: Iterable<number>): void {
    this.mark = Math.max(this.mark, ...numbers);
  }

  /**
   * The number of a key — the stored one, or the next number, stored together with the key before this returns.
   * Synchronous on purpose: two pairings at the same moment can never take the same number. Throws when the file
   * cannot be written; the table is then as it was.
   *
   * @param key the client key
   * @returns the client number
   */
  public add(key: string): number {
    const known = this.numberOf(key);
    if (known !== undefined) {
      return known;
    }
    const previousMark = this.mark;
    const n = previousMark + 1;
    this.keys.set(n, key);
    this.mark = n;
    try {
      this.write();
    } catch (err) {
      this.keys.delete(n);
      this.mark = previousMark;
      throw err;
    }
    return n;
  }

  /**
   * Forget the key of a client number and store that. The table forgets it even when the file cannot be written —
   * the next start drops it again, because its object is gone.
   *
   * @param n the client number
   * @returns the key it held, undefined when it held none
   */
  public remove(n: number): string | undefined {
    const key = this.keys.get(n);
    if (key === undefined) {
      return undefined;
    }
    this.keys.delete(n);
    this.write();
    return key;
  }

  /**
   * Forget every key whose object is gone — deleted while the adapter was stopped — and store that once.
   *
   * @param present the client numbers whose object exists
   * @returns how many keys were forgotten
   */
  public keepOnly(present: ReadonlySet<number>): number {
    const gone = this.numbers().filter(n => !present.has(n));
    for (const n of gone) {
      this.keys.delete(n);
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
    for (const n of this.numbers()) {
      clients[String(n)] = this.keys.get(n) as string;
    }
    writeDataFile(this.dir, CLIENTS_FILE, { lastClientId: this.mark, clients });
  }
}
