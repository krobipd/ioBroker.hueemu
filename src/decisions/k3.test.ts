/**
 * Guard K3 — pairing is open only in the pairing window (50 s after "pair"): every device that asks inside it gets
 * access, none after it.
 *
 * The page of hueemu's core decisions (version 3), example: "You press 'pair'. For 50 seconds every device that comes
 * forward gets access. After that, none." Built by the AI so that Alexa and Harmony can pair; accepted by krobi on
 * 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) opens the window on a
 * `startPairing` command and closes it with its own timer; the bridge's routes (HueServer, inject without a listener)
 * run against that adapter. Precondition: "disable authentication" is off, the default — that setting opens access
 * without a window by the user's own choice.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The stand-in's database and the timers the adapter set. */
const db = vi.hoisted(() => ({
  objects: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
  timers: [] as Array<{ run: () => void; ms: number }>,
}));

vi.mock("@iobroker/adapter-core", () => {
  const full = (id: string): string => (id.startsWith("hueemu.0.") ? id : `hueemu.0.${id}`);
  const noop = (): void => undefined;
  class Adapter {
    public namespace = "hueemu.0";
    public config = {};
    public log = { silly: noop, debug: noop, info: noop, warn: noop, error: noop, level: "info" };
    public on(): void {
      // the guard calls the handlers itself
    }
    public setState(id: string, state: Record<string, unknown>): Promise<string> {
      db.states.set(full(id), { ...state, ts: Date.now(), lc: Date.now() });
      return Promise.resolve(id);
    }
    public setObjectNotExistsAsync(id: string, obj: Record<string, unknown>): Promise<{ id: string }> {
      if (!db.objects.has(full(id))) {
        db.objects.set(full(id), { ...structuredClone(obj), _id: full(id) });
      }
      return Promise.resolve({ id: full(id) });
    }
    public getStatesOfAsync(folder: string): Promise<unknown[]> {
      const found = [...db.objects.values()].filter(
        o => String(o._id).startsWith(`hueemu.0.${folder}.`) && o.type === "state",
      );
      return Promise.resolve(structuredClone(found));
    }
    public getStatesAsync(pattern: string): Promise<Record<string, unknown>> {
      const prefix = full(pattern.replace(/\*$/, ""));
      return Promise.resolve(
        structuredClone(Object.fromEntries([...db.states].filter(([id]) => id.startsWith(prefix)))),
      );
    }
    public getForeignStateAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.states.get(id) ?? null));
    }
    public getForeignObjectAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.objects.get(id) ?? null));
    }
    public setForeignStateAsync(id: string, state: Record<string, unknown>): Promise<string> {
      db.states.set(id, { ...state });
      return Promise.resolve(id);
    }
    public subscribeForeignStates(): void {
      // nothing is bound in this guard
    }
    public unsubscribeForeignStates(): void {
      // nothing is bound in this guard
    }
    public setTimeout(run: () => void, ms: number): Record<string, never> {
      db.timers.push({ run, ms });
      return {};
    }
    public clearTimeout(): void {
      // a cleared timer simply never runs here
    }
  }
  return {
    Adapter,
    getAbsoluteInstanceDataDir: () => "",
    I18n: {
      getTranslatedObject: (key: string) => ({ en: key }),
      translate: (key: string) => key,
      init: () => Promise.resolve(),
    },
  };
});

import * as mainModule from "../main";
import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import { ClientStore } from "../lib/client-store";
import { HueServer } from "../server/hue-server";
import type { BridgeIdentity } from "../types/config";

const { HueEmu } = mainModule as unknown as { HueEmu: new () => ApiHandlerAdapter };

/** What a route answers, read the way a client reads it. */
interface Answer {
  json(): unknown;
}

/** The part of a Fastify instance the guard uses. */
interface Routes {
  inject(request: { method: string; url: string; payload?: unknown }): Promise<Answer>;
  close(): Promise<unknown>;
}

const IDENTITY: BridgeIdentity = {
  udn: "11111111-2222-3333-4444-555555555555",
  mac: "aa:bb:cc:dd:ee:ff",
  bridgeId: "AABBCCFFFEDDEEFF",
  modelId: "BSB002",
  serialNumber: "aabbccddeeff",
};

const folders: string[] = [];
const servers: Routes[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
  db.objects.clear();
  db.states.clear();
  db.timers.length = 0;
});

/**
 * The adapter, its window opened by a `startPairing` command, and the bridge's routes over it.
 */
async function openWindow(): Promise<{ adapter: ApiHandlerAdapter; routes: Routes }> {
  const adapter = new HueEmu();
  const command = { val: true, ack: false, ts: Date.now(), lc: Date.now(), from: "system.adapter.admin.0", q: 0 };
  (adapter as unknown as { onStateChange(id: string, state: unknown): void }).onStateChange(
    "hueemu.0.startPairing",
    command,
  );
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k3-"));
  folders.push(folder);
  const clients = new ClientStore(folder);
  clients.load();
  const handler = new ApiHandler({
    adapter,
    configServiceConfig: { identity: IDENTITY, advertiseHost: "192.168.1.10" },
    devices: [],
    logger: adapter.log,
    clients,
  });
  await handler.initialize();
  const server = new HueServer({
    config: { bind: "0.0.0.0", port: 8080, advertiseHost: "192.168.1.10", identity: IDENTITY, trustProxy: false },
    handler,
    logger: adapter.log,
    isClientAllowed: () => true,
  });
  const routes = await (server as unknown as { createServer(https: boolean): Promise<Routes> }).createServer(false);
  servers.push(routes);
  return { adapter, routes };
}

/**
 * Whether a device with this key reads the lights (an object) instead of an error list.
 *
 * @param routes the bridge's routes
 * @param key the device's key
 */
async function hasAccess(routes: Routes, key: string): Promise<boolean> {
  const answer = await routes.inject({ method: "GET", url: `/api/${key}/lights` });
  return !Array.isArray(answer.json());
}

describe("K3: pairing is open only in the pairing window", () => {
  it("opens the window for 50 seconds after pair", async () => {
    const { adapter } = await openWindow();
    const opened = adapter.pairingEnabled;
    db.timers.find(timer => timer.ms === 50_000)?.run();

    expect({ opened, ms: db.timers.map(timer => timer.ms), closed: !adapter.pairingEnabled }).toEqual({
      opened: true,
      ms: [50_000],
      closed: true,
    });
  });

  it("gives every device that asks inside the window access", async () => {
    const { routes } = await openWindow();
    const refused: string[] = [];
    for (let i = 1; i <= 65; i++) {
      if (!(await hasAccess(routes, `harmony${i}`))) {
        refused.push(`harmony${i}`);
      }
    }

    expect(refused).toEqual([]);
  });

  it("gives no device access after the window", async () => {
    const { routes } = await openWindow();
    const inside = await hasAccess(routes, "echo1");
    db.timers.find(timer => timer.ms === 50_000)?.run();
    const after = await hasAccess(routes, "echo2");
    const paired = await routes.inject({ method: "POST", url: "/api", payload: { devicetype: "echo#late" } });
    const pairedError = (paired.json() as Array<{ error?: { type?: unknown } }>)[0]?.error?.type;

    expect({ inside, after, pairedError }).toEqual({ inside: true, after: false, pairedError: 101 });
  });
});
