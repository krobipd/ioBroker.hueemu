/**
 * Guard K6 — no limit for pairings: the 101st pairing within an hour is accepted like the first.
 *
 * krobi 2026-11-10 16:10, on the page of hueemu's core decisions: "k6 is simply way over the top, who on earth will
 * ever pair 100 Harmonies". The page (version 3) offered "today: the 101st pairing in an hour is refused, with a
 * warning in the log — new: no limit"; krobi accepted it on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: POST /api through the bridge's own routes (HueServer, answered by inject without a listener). A pairing closes
 * the window, as on a real bridge, so the link button is pressed again before every one — what is measured is the
 * pairing itself, not the window.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
}));

import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import { ClientStore } from "../lib/client-store";
import { HueServer } from "../server/hue-server";
import type { BridgeIdentity } from "../types/config";

/** What a route answers, read the way a client reads it. */
interface Answer {
  statusCode: number;
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
});

/** An adapter with an object and state database in memory, the pairing window closed. */
function memoryAdapter(): ApiHandlerAdapter {
  const ns = "hueemu.0";
  const objects = new Map<string, ioBroker.Object>();
  const states = new Map<string, ioBroker.State>();
  const full = (id: string): string => (id.startsWith(`${ns}.`) ? id : `${ns}.${id}`);
  const noop = (): void => undefined;
  return {
    namespace: ns,
    log: { silly: noop, debug: noop, info: noop, warn: noop, error: noop, level: "info" } as unknown as ioBroker.Logger,
    pairingEnabled: false,
    disableAuth: false,
    setObjectNotExistsAsync(id, obj) {
      const key = full(id);
      if (!objects.has(key)) {
        objects.set(key, { ...structuredClone(obj), _id: key } as ioBroker.Object);
      }
      return Promise.resolve({ id: key });
    },
    setState(id, state) {
      const now = Date.now();
      states.set(full(id), { ...(state as ioBroker.State), ts: now, lc: now });
      return Promise.resolve(id);
    },
    getStatesOfAsync(folder) {
      const prefix = `${ns}.${folder}.`;
      const found = [...objects.values()].filter(o => o._id.startsWith(prefix) && o.type === "state");
      return Promise.resolve(structuredClone(found) as ioBroker.StateObject[]);
    },
    getStatesAsync(pattern) {
      const prefix = full(pattern.replace(/\*$/, ""));
      const found = [...states].filter(([id]) => id.startsWith(prefix));
      return Promise.resolve(structuredClone(Object.fromEntries(found)));
    },
    getForeignStateAsync: id => Promise.resolve(structuredClone(states.get(id) ?? null)),
    getForeignObjectAsync: id => Promise.resolve(structuredClone(objects.get(id) ?? null)),
    setForeignStateAsync(id, state) {
      states.set(id, { ...(state as ioBroker.State), ts: Date.now(), lc: Date.now() });
      return Promise.resolve(id);
    },
    subscribeForeignStates: noop,
    unsubscribeForeignStates: noop,
  };
}

/**
 * The bridge's routes over the adapter, the client keys in a fresh data folder.
 *
 * @param adapter the adapter
 */
async function bridgeRoutes(adapter: ApiHandlerAdapter): Promise<Routes> {
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k6-"));
  folders.push(folder);
  const clients = new ClientStore(folder, {
    encrypt(value: string): string {
      return `$/aes-192-cbc:${Buffer.from(value).toString("base64")}`;
    },
    decrypt(value: string): string {
      return Buffer.from(value.replace("$/aes-192-cbc:", ""), "base64").toString();
    },
  });
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
  return routes;
}

describe("K6: no limit for pairings", () => {
  it("accepts the 101st pairing within an hour like the first", async () => {
    const adapter = memoryAdapter();
    const routes = await bridgeRoutes(adapter);
    const names: string[] = [];
    for (let i = 1; i <= 101; i++) {
      adapter.pairingEnabled = true;
      const answer = await routes.inject({ method: "POST", url: "/api", payload: { devicetype: `harmony#hub${i}` } });
      const body = answer.json() as Array<{ success?: { username?: unknown } }>;
      const name = body[0]?.success?.username;
      names.push(typeof name === "string" ? name : "");
    }
    const lights = await routes.inject({ method: "GET", url: `/api/${names[100]}/lights` });

    expect({ first: names[0] !== "", hundredFirst: names[100] !== "", signsIn: !Array.isArray(lights.json()) }).toEqual(
      {
        first: true,
        hundredFirst: true,
        signsIn: true,
      },
    );
  });
});
