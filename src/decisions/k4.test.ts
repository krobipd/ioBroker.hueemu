/**
 * Guard K4 — HTTPS only when an HTTPS port is set; then hueemu creates its own certificate, valid ten years, and keeps it
 * across restarts.
 *
 * The page, K4: "HTTPS is off as long as you enter no HTTPS port; then there is no certificate either. If you enter 443,
 * hueemu creates a certificate of its own, valid ten years, and keeps it across restarts." krobi's question on the page:
 * "k4 the question is, what does the Logitech Harmony need it for?" — Harmony does not need it; only current Echos also
 * try HTTPS on port 443. Origin: built by the AI — measured: before, every start brought a new certificate, and an Echo
 * had to trust the bridge anew each time.
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) reads its identity from the
 * instance data folder and builds its server configuration, as every start does; a restart is a second adapter on the
 * same folder. The host's network interfaces are fixed, so the address the bridge announces does not depend on the
 * machine that runs the guard.
 */

import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type * as Os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The stand-in's instance data folder. */
const data = vi.hoisted(() => ({ folder: "" }));

vi.mock("node:os", async importOriginal => {
  const actual = await importOriginal<typeof Os>();
  const networkInterfaces = (): ReturnType<typeof actual.networkInterfaces> => ({
    eth0: [
      {
        address: "192.168.1.10",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "aa:bb:cc:dd:ee:ff",
        internal: false,
        cidr: "192.168.1.10/24",
      },
    ],
  });
  return { ...actual, default: { ...actual, networkInterfaces }, networkInterfaces };
});

vi.mock("@iobroker/adapter-core", () => {
  const noop = (): void => undefined;
  class Adapter {
    public namespace = "hueemu.0";
    public config: Record<string, unknown> = {};
    public log = { silly: noop, debug: noop, info: noop, warn: noop, error: noop, level: "info" };
    public on(): void {
      // nothing is handled in this guard
    }
    public encrypt(value: string): string {
      return `$/aes-192-cbc:${Buffer.from(value).toString("base64")}`;
    }
    public decrypt(value: string): string {
      return Buffer.from(value.replace("$/aes-192-cbc:", ""), "base64").toString();
    }
  }
  return {
    Adapter,
    getAbsoluteInstanceDataDir: () => data.folder,
    I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
  };
});

import { tmpdir } from "node:os";
import * as mainModule from "../main";
import type { HueEmulatorConfig } from "../types/config";

/** The adapter's own steps of a start the guard calls. */
interface Internals {
  config: Record<string, unknown>;
  loadIdentity(): boolean;
  buildConfig(): HueEmulatorConfig;
}

const { HueEmu } = mainModule as unknown as { HueEmu: new () => Internals };

afterEach(() => {
  rmSync(data.folder, { recursive: true, force: true });
});

/**
 * One start of the adapter on the instance data folder: its identity read, its server configuration built.
 *
 * @param settings the instance settings beside port and address
 */
function start(settings: Record<string, unknown>): HueEmulatorConfig {
  const adapter = new HueEmu();
  adapter.config = { port: 8080, bind: "0.0.0.0", ...settings };
  adapter.loadIdentity();
  return adapter.buildConfig();
}

/** What the identity file in the instance data folder holds. */
function storedIdentity(): Record<string, unknown> {
  const file = join(data.folder, "identity.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
}

describe("K4: HTTPS only on request, with a certificate of its own", () => {
  it("serves no HTTPS and creates no certificate while no HTTPS port is set", () => {
    data.folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k4-"));
    const config = start({});

    expect({ https: config.https, certificate: storedIdentity().tlsCert }).toEqual({
      https: undefined,
      certificate: undefined,
    });
  });

  it("creates its own certificate, valid ten years, once an HTTPS port is set, and keeps it across restarts", () => {
    data.folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k4-"));
    const first = start({ httpsPort: 8443 });
    const restarted = start({ httpsPort: 8443 });
    const certificate = new X509Certificate(first.https?.cert ?? "");
    const years = new Date(certificate.validTo).getUTCFullYear() - new Date(certificate.validFrom).getUTCFullYear();
    // The same certificate, whatever line endings its text comes back with.
    const kept = new X509Certificate(restarted.https?.cert ?? "").fingerprint256 === certificate.fingerprint256;

    expect({ port: first.https?.port, years, kept }).toEqual({
      port: 8443,
      years: 10,
      kept: true,
    });
  });
});
