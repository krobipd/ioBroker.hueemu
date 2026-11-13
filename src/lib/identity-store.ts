/**
 * The bridge identity that must survive every restart and update — the UDN every paired
 * client knows the bridge by, and the self-signed TLS pair — kept in a file in the
 * instance data folder, never in the instance's `native`.
 *
 * Audit R-24 (B02 `audit_own_native_at_runtime`, krobi 2026-11-05 22:46, CLAUDE_PATTERNS
 * § "native belongs to the user"): the settings page writes back the `native` it opened
 * with, and every write to `native` restarts the instance. Up to v1.19.0 the first start
 * wrote the generated UDN, MAC and certificate there and restarted once.
 *
 * What an earlier version left in `native` (udn, tlsCert, tlsKey) is taken over once;
 * only after the file holds it does the native-key migration drop those keys
 * (native-key-list.ts). The MAC stays a field of the settings page: empty, it is derived
 * from the UDN on every start and never written.
 *
 * The private key is a secret the adapter generates (CLAUDE_PATTERNS.md, Geheimnisse S3/S7,
 * round 174): the fleet master stores it encrypted with the system secret under the field
 * {@link KEY_FIELD} and gives it back in clear text — this file never encrypts it itself.
 * The UDN is an id the adapter generates and must keep (S9): a file that cannot be read
 * fails the start instead of making a new one (main.ts `loadIdentity`).
 *
 * After an update js-controller sets the instance's `encryptedNative` to the manifest's
 * list, which no longer names `tlsKey` (setupUpload.ts `_upgradeAdapterObjectsHelper`,
 * v7.2.2) — a key stored by v1.19.0 therefore arrives still encrypted, one stored by
 * v1.18.0 or earlier in plain text. Both are taken over in clear text.
 */

import { type DataFileCipher, type DataFileSecrets, readDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const IDENTITY_FILE = "identity.json";

/** The field that holds the private key — a name the fleet's word list knows as a secret (S7: `^private.*`). */
export const KEY_FIELD = "privateKey";

/** js-controller's prefix of a value it encrypted (`tools.encrypt`, v7.2.2). */
const ENCRYPTED_PREFIX = "$/aes-192-cbc:";

/** What the file holds. */
export interface StoredIdentity {
  /** The bridge UUID every client knows the bridge by. */
  udn: string;
  /** The self-signed certificate, PEM. */
  tlsCert?: string;
  /** Its private key, PEM — clear text here, encrypted in the file. */
  privateKey?: string;
}

/** The result of reading the file: nothing there, the identity, or why it is unusable. */
export interface IdentityRead {
  /** The stored identity, when the file holds a usable one. */
  identity?: StoredIdentity;
  /** Set when the file exists but cannot be used. */
  error?: string;
}

/** The values an earlier version stored in `native`, whatever type they have. */
export interface LegacyIdentity {
  /** `native.udn` */
  udn: unknown;
  /** `native.tlsCert` */
  tlsCert: unknown;
  /** `native.tlsKey` — encrypted (v1.19.0) or plain text (up to v1.18.0) */
  tlsKey: unknown;
}

/**
 * A trimmed text, or "" for anything that is not one (type guard at the boundary).
 *
 * @param value a value from the file or from `native`
 */
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * The secret fields of the file.
 *
 * @param cipher the adapter instance
 */
const secretsOf = (cipher: DataFileCipher): DataFileSecrets => ({ cipher, fields: [KEY_FIELD] });

/**
 * Read the identity file.
 *
 * @param dir the instance data folder
 * @param cipher decrypts the private key — the adapter instance
 * @returns the identity, nothing (no file yet), or the reason the file is unusable
 */
export function readIdentity(dir: string, cipher: DataFileCipher): IdentityRead {
  const read = readDataFile(dir, IDENTITY_FILE, secretsOf(cipher));
  if (read.error !== undefined || read.value === undefined) {
    return read.error === undefined ? {} : { error: read.error };
  }
  const data = (typeof read.value === "object" && read.value !== null ? read.value : {}) as Record<string, unknown>;
  const udn = text(data.udn);
  if (!udn) {
    return { error: "no UDN in it" };
  }
  const identity: StoredIdentity = { udn };
  const tlsCert = text(data.tlsCert);
  const privateKey = text(data[KEY_FIELD]);
  if (tlsCert && privateKey) {
    identity.tlsCert = tlsCert;
    identity.privateKey = privateKey;
  }
  return { identity };
}

/**
 * Write the identity file (data-file.ts: temporary file renamed over the old one, owner-only, the key encrypted).
 *
 * @param dir the instance data folder (created when missing)
 * @param identity what to store
 * @param cipher encrypts the private key — the adapter instance
 */
export function writeIdentity(dir: string, identity: StoredIdentity, cipher: DataFileCipher): void {
  writeDataFile(dir, IDENTITY_FILE, identity, secretsOf(cipher));
}

/**
 * The private key an earlier version left in `native`, in clear text. Only a value with
 * js-controller's prefix is decrypted — anything else would go through its legacy
 * decryption and come out as garbage. A value that cannot be decrypted is no key: the
 * start generates a new pair.
 *
 * @param key `native.tlsKey` — encrypted (v1.19.0) or plain text (up to v1.18.0)
 * @param decrypt the adapter's `decrypt`
 */
export function legacyKeyOf(key: string, decrypt: (value: string) => string): string {
  if (!key.startsWith(ENCRYPTED_PREFIX)) {
    return key;
  }
  try {
    return decrypt(key);
  } catch {
    return "";
  }
}

/**
 * The identity for this start: the stored one, or — on the first start of this version or
 * of a new instance — the one an earlier version left in `native`, with a fresh UDN when
 * there is none.
 *
 * @param stored what the file holds, if anything
 * @param legacy what an earlier version stored in `native`
 * @param newUdn makes a fresh UUID
 * @param decrypt the adapter's `decrypt`
 * @returns the identity, and whether it still has to be stored
 */
export function resolveIdentity(
  stored: StoredIdentity | undefined,
  legacy: LegacyIdentity,
  newUdn: () => string,
  decrypt: (value: string) => string,
): { identity: StoredIdentity; unsaved: boolean } {
  if (stored) {
    return { identity: stored, unsaved: false };
  }
  const identity: StoredIdentity = { udn: text(legacy.udn) || newUdn() };
  const tlsCert = text(legacy.tlsCert);
  const privateKey = legacyKeyOf(text(legacy.tlsKey), decrypt);
  if (tlsCert && privateKey) {
    identity.tlsCert = tlsCert;
    identity.privateKey = privateKey;
  }
  return { identity, unsaved: true };
}
