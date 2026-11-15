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
 *
 * `udn`, `tlsCert` and `tlsKey` (audit R-24): the bridge identity moved to a file in the instance
 * data folder (identity-store.ts). They are dropped only once that file holds the identity — a
 * drop before it would give every paired client a new bridge on the next start. The start never
 * gets here before: one that cannot read or store the identity fails (main.ts `loadIdentity`, S9).
 *
 * `secure` (the fleet's HTTPS option, krobi 2026-11-14 19:15, translated: "yes, k4 shall be replaced by the fleet
 * rule"): up to v1.19.0 a
 * set `httpsPort` alone switched HTTPS on, with a certificate of hueemu's own. Now the switch is `secure` (manifest
 * default `false`, which js-controller adds to every existing installation on the update) and the certificate comes from
 * ioBroker. An installation that served HTTPS keeps it: on the first start of this version a set `httpsPort` turns
 * `secure` on — once. The marks of that first start are the identity file this start had to write (no earlier version
 * wrote one) and the own certificate still in `native.tlsCert`; the latter goes in the same write as `secure`, so a
 * failed write repeats the step and a user who switches HTTPS off afterwards is never switched on again.
 *
 * `devices` and `lastLightId` (audit R-24): the lights moved to their own device objects (`lights.<n>`, light-store.ts),
 * the mark to a file in the instance data folder. They are dropped only once every light is stored there — a drop
 * before it would lose the lights.
 */

import { parsePort } from "./coerce";
import type { NativeKeyMigration } from "./native-key-migration";
import { chosenAddress } from "./network-address";

/**
 * "Listen on all interfaces" — empty or the wildcard.
 *
 * @param v a stored listen address
 */
const listensEverywhere = (v: unknown): boolean => chosenAddress(v) === undefined;

/**
 * The migrations for this start.
 *
 * @param native the instance's current native settings
 * @param localAddresses the addresses this host carries right now (`localNets` of the fleet master)
 * @param lightsStored whether every light of the settings is a light object, the mark in its file
 * @param identityNew whether this start wrote the identity file first — the first start of this version
 * @returns the list for `migrateNativeKeys`
 */
export function buildNativeKeyMigrations(
  native: Record<string, unknown>,
  localAddresses: readonly string[],
  lightsStored: boolean,
  identityNew: boolean,
): NativeKeyMigration[] {
  const migrations: NativeKeyMigration[] = [
    { from: "host", to: "bind", coerce: v => (typeof v === "string" && v.trim()) || "0.0.0.0" },
    { key: "port", coerce: v => (typeof v === "string" ? Number.parseInt(v, 10) : v) },
  ];

  const legacy = typeof native.advertiseHost === "string" ? native.advertiseHost.trim() : "";
  // Before the v1.18.0 rename the listen address still sits under `host`.
  const effectiveBind = native.host !== undefined && native.host !== null ? native.host : native.bind;
  if (chosenAddress(legacy) !== undefined && listensEverywhere(effectiveBind) && localAddresses.includes(legacy)) {
    migrations.push({ from: "advertiseHost", to: "bind", coerce: v => (typeof v === "string" ? v.trim() : v) });
  } else {
    migrations.push({ drop: "advertiseHost" });
  }

  migrations.push({ drop: "discoveryHost" }, { drop: "discoveryPort" }, { drop: "upnpPort" });
  const ownCertificate = typeof native.tlsCert === "string" && native.tlsCert.trim() !== "";
  if ((identityNew || ownCertificate) && parsePort(native.httpsPort) !== undefined) {
    migrations.push({ key: "secure", coerce: () => true });
  }
  migrations.push({ drop: "udn" }, { drop: "tlsCert" }, { drop: "tlsKey" });
  if (lightsStored) {
    migrations.push({ drop: "devices" }, { drop: "lastLightId" });
  }
  migrations.push(
    { commonDrop: "license" },
    { commonDrop: "main" },
    { commonDrop: "supportCustoms" },
    { commonDrop: "materialize" },
    { commonDrop: "connectionType " },
  );
  return migrations;
}
