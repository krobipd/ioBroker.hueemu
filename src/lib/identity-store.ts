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
 * The private key stays encrypted with the system secret (design decision 8). After an
 * update js-controller sets the instance's `encryptedNative` to the manifest's list, which
 * no longer names `tlsKey` (setupUpload.ts `_upgradeAdapterObjectsHelper`, v7.2.2) — a key
 * stored by v1.19.0 therefore arrives still encrypted, one stored by v1.18.0 or earlier in
 * plain text. Both are taken over.
 */

import { readDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const IDENTITY_FILE = "identity.json";

/** js-controller's prefix of a value it encrypted (`tools.encrypt`, v7.2.2). */
const ENCRYPTED_PREFIX = "$/aes-192-cbc:";

/** What the file holds. */
export interface StoredIdentity {
  /** The bridge UUID every client knows the bridge by. */
  udn: string;
  /** The self-signed certificate, PEM. */
  tlsCert?: string;
  /** Its private key, encrypted with the system secret. */
  tlsKey?: string;
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
 * Read the identity file.
 *
 * @param dir the instance data folder
 * @returns the identity, nothing (no file yet), or the reason the file is unusable
 */
export function readIdentity(dir: string): IdentityRead {
  const read = readDataFile(dir, IDENTITY_FILE);
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
  const tlsKey = text(data.tlsKey);
  if (tlsCert && tlsKey) {
    identity.tlsCert = tlsCert;
    identity.tlsKey = tlsKey;
  }
  return { identity };
}

/**
 * Write the identity file (data-file.ts: temporary file renamed over the old one, owner-only).
 *
 * @param dir the instance data folder (created when missing)
 * @param identity what to store
 */
export function writeIdentity(dir: string, identity: StoredIdentity): void {
  writeDataFile(dir, IDENTITY_FILE, identity);
}

/**
 * The private key in the form the file stores: encrypted with the system secret.
 *
 * @param key a key from `native` — encrypted (v1.19.0) or plain text (up to v1.18.0)
 * @param encrypt the adapter's `encrypt`
 */
export function storedKeyOf(key: string, encrypt: (value: string) => string): string {
  return key.startsWith(ENCRYPTED_PREFIX) ? key : encrypt(key);
}

/**
 * The private key in plain text, for the HTTPS listener. Only a value with
 * js-controller's prefix is decrypted — anything else would go through its legacy
 * decryption and come out as garbage. A value that cannot be decrypted is no key:
 * the caller generates a new pair.
 *
 * @param key the stored key
 * @param decrypt the adapter's `decrypt`
 */
export function plainKeyOf(key: string | undefined, decrypt: (value: string) => string): string {
  if (!key) {
    return "";
  }
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
 * @param encrypt the adapter's `encrypt`
 * @returns the identity, and whether it still has to be stored
 */
export function resolveIdentity(
  stored: StoredIdentity | undefined,
  legacy: LegacyIdentity,
  newUdn: () => string,
  encrypt: (value: string) => string,
): { identity: StoredIdentity; unsaved: boolean } {
  if (stored) {
    return { identity: stored, unsaved: false };
  }
  const identity: StoredIdentity = { udn: text(legacy.udn) || newUdn() };
  const tlsCert = text(legacy.tlsCert);
  const tlsKey = text(legacy.tlsKey);
  if (tlsCert && tlsKey) {
    identity.tlsCert = tlsCert;
    identity.tlsKey = storedKeyOf(tlsKey, encrypt);
  }
  return { identity, unsaved: true };
}
