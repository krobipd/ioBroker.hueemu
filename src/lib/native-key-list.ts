/**
 * hueemu's own list of instance-settings migrations, handed to the fleet helper
 * `migrateNativeKeys` (native-key-migration.ts, a byte-equal copy of the fleet master).
 *
 * Fixed entries (v1.18.0): `host` → `bind` (an empty legacy value meant "all interfaces")
 * and the manifest default `"8080"` (a string until v1.17.1) → the number the port field writes.
 *
 * Keys earlier versions declared and this one no longer reads are dropped, so they do not
 * stay in every existing installation for good: `discoveryHost` and `discoveryPort` (gone in
 * v1.9.0) and `upnpPort` (gone after v1.5.2).
 *
 * `advertiseHost` (v1.9.0–v1.11.x, a separate "announced IP" field) is the one key that still
 * changed behaviour: an instance listening on all interfaces announced it instead of the
 * detected address. It moves into `bind` only when that keeps the behaviour — the instance
 * listens on all interfaces AND the address still belongs to this host; a stale address would
 * make the server bind to nothing. In every other case it is dropped. A static rename would be
 * wrong: the fleet helper lets the first MEANINGFUL source win, so a leftover `advertiseHost`
 * would overwrite an address the user chose later.
 *
 * The `common` keys earlier manifests declared and this one no longer does are nulled as well
 * (v1.19.0): js-controller merges the manifest's `common` into the instance object on every update
 * and never removes a key, so `license`, `main` and `supportCustoms` (up to v1.0.4) still sit in
 * every installation from that time. The pre-release manifests (0.0.x) also carried `materialize`
 * and `connectionType` with a trailing space — a different key from the `connectionType` the
 * manifest still declares, which is therefore never nulled.
 */

import type { NativeKeyMigration } from "./native-key-migration";

/**
 * "Listen on all interfaces" — empty or the wildcard.
 *
 * @param v a stored listen address
 */
const listensEverywhere = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && (v.trim() === "" || v.trim() === "0.0.0.0"));

/**
 * The migrations for this start.
 *
 * @param native the instance's current native settings
 * @param localAddresses the IPv4 addresses this host carries right now
 * @returns the list for `migrateNativeKeys`
 */
export function buildNativeKeyMigrations(
  native: Record<string, unknown>,
  localAddresses: readonly string[],
): NativeKeyMigration[] {
  const migrations: NativeKeyMigration[] = [
    { from: "host", to: "bind", coerce: v => (typeof v === "string" && v.trim()) || "0.0.0.0" },
    { key: "port", coerce: v => (typeof v === "string" ? Number.parseInt(v, 10) : v) },
  ];

  const legacy = typeof native.advertiseHost === "string" ? native.advertiseHost.trim() : "";
  // Before the v1.18.0 rename the listen address still sits under `host`.
  const effectiveBind = native.host !== undefined && native.host !== null ? native.host : native.bind;
  if (legacy !== "" && legacy !== "0.0.0.0" && listensEverywhere(effectiveBind) && localAddresses.includes(legacy)) {
    migrations.push({ from: "advertiseHost", to: "bind", coerce: v => (typeof v === "string" ? v.trim() : v) });
  } else {
    migrations.push({ drop: "advertiseHost" });
  }

  migrations.push({ drop: "discoveryHost" }, { drop: "discoveryPort" }, { drop: "upnpPort" });
  migrations.push(
    { commonDrop: "license" },
    { commonDrop: "main" },
    { commonDrop: "supportCustoms" },
    { commonDrop: "materialize" },
    { commonDrop: "connectionType " },
  );
  return migrations;
}
