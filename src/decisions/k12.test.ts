/**
 * Guard K12 — writes fit the target datapoint: clamped to its min/max (6500 K), a read-only datapoint is not written, a
 * text switch gets its own texts for on and off.
 *
 * The page, K12: "A lamp can do 6500 K at most. Alexa wants more, so hueemu writes 6500. A read-only datapoint is not
 * written. A text switch gets its own text for 'on' and 'off'." Origin: built by the AI in the audit — measured on
 * foreign lamp adapters: before, every command gave a warning from ioBroker.
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
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k12-"));
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
 * Pair one device through the link button, as a Harmony hub does, and close the window again.
 *
 * @param mem the adapter
 * @param routes the bridge's routes
 * @returns the key the device got
 */
async function pair(mem: Memory, routes: Routes): Promise<string> {
  mem.adapter.pairingEnabled = true;
  const answer = await routes.inject({ method: "POST", url: "/api", payload: { devicetype: "harmony#hub" } });
  mem.adapter.pairingEnabled = false;
  const name = (answer.json() as Array<{ success?: { username?: unknown } }>)[0]?.success?.username;
  return typeof name === "string" ? name : "";
}

describe("K12: writes fit the target datapoint", () => {
  it("clamps to the datapoint's limits, writes no read-only datapoint, and gives a text switch its own texts", async () => {
    const mem = memory({
      "javascript.0.ct": {
        type: "number",
        role: "level.color.temperature",
        unit: "K",
        min: 2200,
        max: 6500,
        write: true,
      },
      "javascript.0.level": { type: "number", role: "value.brightness", unit: "%", min: 0, max: 100, write: false },
      "javascript.0.power": { type: "string", role: "switch", states: { ON: "On", OFF: "Off" }, write: true },
    });
    const { routes } = await bridge(mem, [
      {
        id: 1,
        name: "Lamp",
        lightType: "ct",
        onState: "javascript.0.power",
        briState: "javascript.0.level",
        ctState: "javascript.0.ct",
      },
    ]);
    const key = await pair(mem, routes);
    await routes.inject({ method: "PUT", url: `/api/${key}/lights/1/state`, payload: { ct: 153, bri: 200 } });
    await routes.inject({ method: "PUT", url: `/api/${key}/lights/1/state`, payload: { on: true } });
    await routes.inject({ method: "PUT", url: `/api/${key}/lights/1/state`, payload: { on: false } });

    expect(mem.writes).toEqual([
      ["javascript.0.ct", 6500],
      ["javascript.0.power", "ON"],
      ["javascript.0.power", "OFF"],
    ]);
  });
});
