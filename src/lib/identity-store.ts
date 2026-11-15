/**
 * The bridge identity that must survive every restart and update — the UDN every paired
 * client knows the bridge by — kept in a file in the instance data folder, never in the
 * instance's `native`.
 *
 * Audit R-24 (B02 `audit_own_native_at_runtime`, krobi 2026-11-05 22:46, CLAUDE_PATTERNS
 * § "native belongs to the user"): the settings page writes back the `native` it opened
 * with, and every write to `native` restarts the instance. Up to v1.19.0 the first start
 * wrote the generated UDN, MAC and certificate there and restarted once.
 *
 * What an earlier version left in `native.udn` is taken over once; only after the file holds
 * it does the native-key migration drop the key (native-key-list.ts). The MAC stays a field of
 * the settings page: empty, it is derived from the UDN on every start and never written.
 *
 * The own self-signed certificate (`native.tlsCert`, `native.tlsKey` up to v1.19.0) is gone:
 * HTTPS takes a certificate of ioBroker through the fleet's HTTPS option (secure-server.ts,
 * krobi 2026-11-14 19:15, translated: "yes, k4 shall be replaced by the fleet rule"), so the file holds no key and
 * nothing in it is secret. The UDN is an id the adapter generates and must keep (CLAUDE_PATTERNS.md,
 * Geheimnisse S9, round 174): a file that cannot be read fails the start instead of making a new
 * one (main.ts `loadIdentity`).
 */

import { readDataFile, writeDataFile } from "./data-file";

/** The file in the instance data folder. */
export const IDENTITY_FILE = "identity.json";

/** What the file holds. */
export interface StoredIdentity {
  /** The bridge UUID every client knows the bridge by. */
  udn: string;
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
  return { identity: { udn } };
}

/**
 * Write the identity file (data-file.ts: temporary file renamed over the old one, owner-only).
 *
 * @param dir the instance data folder (created when missing)
 * @param identity what to store
 */
export function writeIdentity(dir: string, identity: StoredIdentity): void {
  writeDataFile(dir, IDENTITY_FILE, { udn: identity.udn });
}

/**
 * The identity for this start: the stored one, or — on the first start of this version or
 * of a new instance — the UDN an earlier version left in `native`, a fresh one when there is
 * none.
 *
 * @param stored what the file holds, if anything
 * @param legacy what an earlier version stored in `native`
 * @param newUdn makes a fresh UUID
 * @returns the identity, and whether it still has to be stored
 */
export function resolveIdentity(
  stored: StoredIdentity | undefined,
  legacy: LegacyIdentity,
  newUdn: () => string,
): { identity: StoredIdentity; unsaved: boolean } {
  if (stored) {
    return { identity: stored, unsaved: false };
  }
  return { identity: { udn: text(legacy.udn) || newUdn() }, unsaved: true };
}
