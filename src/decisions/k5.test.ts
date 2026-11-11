/**
 * Guard K5 — the query of the bridge data never pairs: a search app asking inside the window gets the answer but no
 * access.
 *
 * The page, K5: "A search app asks for the bridge's data inside the pairing window. It gets the answer, but no access."
 * Origin: built by the AI in 1.14.0 — before, such a query alone would have made the app's name a valid key.
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the bridge's own routes (HueServer, answered by inject without a listener) over an adapter whose object and
 * state database lives in memory.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
}));

import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import type { DeviceConfig } from "../hue-api/device-binding-service";
import { ClientStore } from "../lib/client-store";
import { HueServer } from "../server/hue-server";
import type { BridgeIdentity } from "../types/config";

/** What a route answers, read the way a client reads it. */
interface Answer {
  json(): unknown;
}

/** The part of a Fastify instance the guard uses. */
interface Routes {
  inject(request: { method: string; url: string; payload?: unknown }): Promise<Answer>;
  close(): Promise<unknown>;
}

/** An adapter over a database in memory, with what it wrote. */
interface Memory {
  adapter: ApiHandlerAdapter;
  /** Every write to a foreign datapoint, in order. */
  writes: Array<[string, unknown]>;
  /** Every own object the adapter created. */
  created: string[];
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

/**
 * An adapter whose foreign datapoints are the given ones, the pairing window closed.
 *
 * @param datapoints the foreign datapoints by id, each with its common
 */
function memory(datapoints: Record<string, Partial<ioBroker.StateCommon>>): Memory {
  const ns = "hueemu.0";
  const objects = new Map<string, ioBroker.Object>();
  for (const [id, common] of Object.entries(datapoints)) {
    objects.set(id, { _id: id, type: "state", common: { name: id, ...common }, native: {} } as ioBroker.Object);
  }
  const states = new Map<string, ioBroker.State>();
  const writes: Array<[string, unknown]> = [];
  const created: string[] = [];
  const full = (id: string): string => (id.startsWith(`${ns}.`) ? id : `${ns}.${id}`);
  const noop = (): void => undefined;
  const adapter: ApiHandlerAdapter = {
    namespace: ns,
    log: { silly: noop, debug: noop, info: noop, warn: noop, error: noop, level: "info" } as unknown as ioBroker.Logger,
    pairingEnabled: false,
    disableAuth: false,
    setObjectNotExistsAsync(id, obj) {
      const key = full(id);
      if (!objects.has(key)) {
        objects.set(key, { ...structuredClone(obj), _id: key } as ioBroker.Object);
        created.push(key);
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
      return Promise.resolve(structuredClone(Object.fromEntries([...states].filter(([id]) => id.startsWith(prefix)))));
    },
    getForeignStateAsync: id => Promise.resolve(structuredClone(states.get(id) ?? null)),
    getForeignObjectAsync: id => Promise.resolve(structuredClone(objects.get(id) ?? null)),
    setForeignStateAsync(id, state) {
      const value = (state as ioBroker.State).val;
      writes.push([id, value]);
      states.set(id, { ...(state as ioBroker.State), ts: Date.now(), lc: Date.now() });
      return Promise.resolve(id);
    },
    subscribeForeignStates: noop,
    unsubscribeForeignStates: noop,
  };
  return { adapter, writes, created };
}

/**
 * The bridge's routes over the adapter, serving the given lights, the client keys in a fresh data folder.
 *
 * @param mem the adapter
 * @param devices the lights the user assigned
 */
async function bridge(mem: Memory, devices: DeviceConfig[]): Promise<{ routes: Routes; folder: string }> {
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k5-"));
  folders.push(folder);
  const clients = new ClientStore(folder);
  clients.load();
  const handler = new ApiHandler({
    adapter: mem.adapter,
    configServiceConfig: { identity: IDENTITY, advertiseHost: "192.168.1.10" },
    devices,
    logger: mem.adapter.log,
    clients,
  });
  await handler.initialize();
  const server = new HueServer({
    config: { bind: "0.0.0.0", port: 8080, advertiseHost: "192.168.1.10", identity: IDENTITY, trustProxy: false },
    handler,
    logger: mem.adapter.log,
    isClientAllowed: () => true,
  });
  const routes = await (server as unknown as { createServer(https: boolean): Promise<Routes> }).createServer(false);
  servers.push(routes);
  return { routes, folder };
}

/**
 * The Hue error type of the first entry of an answer, undefined when it is no error.
 *
 * @param answer what the route answered
 */
function errorType(answer: Answer): unknown {
  const body = answer.json();
  return Array.isArray(body) ? (body[0] as { error?: { type?: unknown } } | undefined)?.error?.type : undefined;
}

describe("K5: the query of the bridge data never pairs", () => {
  it("answers the bridge data inside the window and gives the asking app no access", async () => {
    const mem = memory({});
    const { routes } = await bridge(mem, []);
    mem.adapter.pairingEnabled = true;
    const config = (await routes.inject({ method: "GET", url: "/api/nouser/config" })).json() as Record<
      string,
      unknown
    >;
    mem.adapter.pairingEnabled = false;
    const lights = await routes.inject({ method: "GET", url: "/api/nouser/lights" });

    expect({
      bridgeid: config.bridgeid,
      whitelist: "whitelist" in config,
      lights: errorType(lights),
      objects: mem.created,
    }).toEqual({ bridgeid: "AABBCCFFFEDDEEFF", whitelist: false, lights: 1, objects: [] });
  });
});
