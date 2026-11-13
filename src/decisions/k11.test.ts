/**
 * Guard K11 — only the group "all lights" exists: any other group number gets "not available", no light changes.
 *
 * The page, K11: today "A device switches group 5. It gets the message 'does not exist', no light changes."; before
 * "Every group number switched all lights." Origin: built by the AI in the audit, after the model of diyHue.
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
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k11-"));
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

/**
 * The Hue error type of the first entry of an answer, undefined when it is no error.
 *
 * @param answer what the route answered
 */
function errorType(answer: Answer): unknown {
  const body = answer.json();
  return Array.isArray(body) ? (body[0] as { error?: { type?: unknown } } | undefined)?.error?.type : undefined;
}

describe("K11: only the group 'all lights' exists", () => {
  it("answers group 5 with error 3 and changes no light", async () => {
    const mem = memory({ "javascript.0.hall": { type: "boolean", role: "switch.light", write: true } });
    const { routes } = await bridge(mem, [{ id: 1, name: "Hall", lightType: "onoff", onState: "javascript.0.hall" }]);
    const key = await pair(mem, routes);
    const answer = await routes.inject({ method: "PUT", url: `/api/${key}/groups/5/action`, payload: { on: true } });

    expect({ group: errorType(answer), writes: mem.writes }).toEqual({ group: 3, writes: [] });
  });
});
