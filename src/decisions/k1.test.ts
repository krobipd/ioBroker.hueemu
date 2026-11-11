/**
 * Guard K1 — a new instance listens on port 8080 by default.
 *
 * The page, K1: "A new instance listens on port 8080. For current Echos you set 80 and 443 yourself; the manual describes
 * that." Origin: chosen by the AI at the first build, because Harmony runs with 8080.
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: what a new instance gets — the manifest's `native.port` (js-controller copies it into every new instance) and
 * the default of the port field on the settings page.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The adapter's root folder: two levels above this file. */
const ROOT = join(__dirname, "..", "..");

/**
 * The port field of the settings page, wherever it sits in the page's tree.
 *
 * @param node a part of the page
 */
function portField(node: unknown): { default?: unknown } | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "port" && value && typeof value === "object" && "type" in value) {
      return value as { default?: unknown };
    }
    const found = portField(value);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe("K1: port 8080 by default", () => {
  it("gives a new instance port 8080, in the manifest and on the settings page", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "io-package.json"), "utf8")) as { native?: { port?: unknown } };
    const page = JSON.parse(readFileSync(join(ROOT, "admin", "jsonConfig.json"), "utf8")) as unknown;

    expect({ instance: manifest.native?.port, form: portField(page)?.default }).toEqual({ instance: 8080, form: 8080 });
  });
});
