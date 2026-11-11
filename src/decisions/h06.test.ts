/**
 * Guard H-06 — a paired device is named in the object tree after its device text and the last four characters of its
 * key; without a text the front part is "client", a taken id gets a counter; the key itself stands only in a file in
 * the instance's data folder.
 *
 * The register, H-06: "A paired device is named in the object tree after its device text and the last four characters
 * of its key. If it names no text when pairing, 'client' stands in front; if the id is already taken, a counter
 * follows. The key itself stands only in a file in the instance's data folder, not in the id, not in the value and not
 * in the hidden data. Applies to hueemu only."
 * krobi 2026-11-11 14:27, on the question "Do you accept the id clients.harmony-hub-ac37 (model, hyphen, last 4
 * characters of the key) for the paired devices?": "1. yes, that sounds good." The counter for a taken id is the AI's
 * choice from the proposal he said yes to. Accepted by krobi with the page of hueemu's datapoint tree
 * (Ressourcen/hueemu/baum-2026-11-11e.html) on 2026-11-11 16:59 ("yes").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) loads the client keys from its
 * instance data folder and moves a client of the earlier form (`clients.<key>`, the key in `native.username` and as
 * the value) at start; the bridge's routes (HueServer, inject without a listener) pair the devices against it — a
 * `POST /api` with the device text inside the pairing window, or a device the window takes in without one. Every line
 * the adapter logs, on any level, is recorded: the key stands in none of them either (werkbank-adapter 2026-11-11, on
 * the third sentence: no log line names a whole key).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The stand-in's database, the timers the adapter set, the instance data folder, every line it logged — and whether
 * the database refuses a new object.
 */
const db = vi.hoisted(() => ({
  objects: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
  timers: [] as Array<{ run: () => void; ms: number }>,
  dir: "",
  logs: [] as string[],
  refuse: false,
}));

vi.mock("@iobroker/adapter-core", () => {
  const full = (id: string): string => (id.startsWith("hueemu.0.") ? id : `hueemu.0.${id}`);
  const record = (message: unknown): void => {
    db.logs.push(String(message));
  };
  class Adapter {
    public namespace = "hueemu.0";
    public config = {};
    public log = { silly: record, debug: record, info: record, warn: record, error: record, level: "silly" };
    public on(): void {
      // the guard calls the handlers itself
    }
    public setState(id: string, state: Record<string, unknown>): Promise<string> {
      db.states.set(full(id), { ts: Date.now(), lc: Date.now(), ...state });
      return Promise.resolve(id);
    }
    public setObjectNotExistsAsync(id: string, obj: Record<string, unknown>): Promise<{ id: string }> {
      if (db.refuse) {
        return Promise.reject(new Error("the database refuses the object"));
      }
      if (!db.objects.has(full(id))) {
        db.objects.set(full(id), { ...structuredClone(obj), _id: full(id) });
      }
      return Promise.resolve({ id: full(id) });
    }
    public getObjectAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.objects.get(full(id)) ?? null));
    }
    public getObjectListAsync({ startkey, endkey }: { startkey: string; endkey: string }): Promise<unknown> {
      const rows = [...db.objects]
        .filter(([id]) => id >= startkey && id <= endkey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => ({ id, value: structuredClone(value) }));
      return Promise.resolve({ rows });
    }
    public delObjectAsync(id: string): Promise<void> {
      db.objects.delete(full(id));
      db.states.delete(full(id));
      return Promise.resolve();
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
    public getForeignObjectsAsync(): Promise<Record<string, unknown>> {
      // no room or function lists a client in this guard
      return Promise.resolve({});
    }
    public getForeignStateAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.states.get(id) ?? null));
    }
    public getForeignObjectAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.objects.get(id) ?? null));
    }
    public setForeignObject(id: string, obj: Record<string, unknown>): Promise<{ id: string }> {
      db.objects.set(id, { ...structuredClone(obj), _id: id });
      return Promise.resolve({ id });
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
    getAbsoluteInstanceDataDir: () => db.dir,
    I18n: {
      getTranslatedObject: (key: string) => ({ en: key }),
      translate: (key: string) => key,
      init: () => Promise.resolve(),
    },
  };
});

import * as mainModule from "../main";
import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import type { ClientStore } from "../lib/client-store";
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

/** A key as a Harmony Hub pairs with it — 36 characters, ending in "ac37". */
const HUB_KEY = "16f8b066-5b1e-4c3a-9d2f-0a1b2c3dac37";
/** A second hub's key with the same last four characters. */
const TWIN_KEY = "c4665271-7d2e-4f1a-8b3c-5e6f7a8bac37";
/** The key of a hub paired before the update, as the earlier form kept it. */
const OLD_KEY = "0d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d3b9";
/** A device the pairing window takes in without a text. */
const SILENT_KEY = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b0001";
/** A device the pairing window would take in while the database refuses its object. */
const REFUSED_KEY = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f0002";

const folders: string[] = [];
const servers: Routes[] = [];
/** Whether the next request comes from outside the adapter's networks. */
const network = { foreign: false };

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
  db.dir = "";
  db.logs.length = 0;
  db.refuse = false;
  network.foreign = false;
});

/** A hub paired with the version before the update: `clients.<key>`, the key in native and as the value. */
function oldClient(): void {
  const id = `hueemu.0.clients.${OLD_KEY}`;
  db.objects.set(id, {
    _id: id,
    type: "state",
    common: { name: { en: "Harmony Hub" }, type: "string", role: "text", read: true, write: false },
    native: { username: OLD_KEY },
  });
  db.states.set(id, { val: OLD_KEY, ack: true, ts: 1, lc: 1, from: "system.adapter.hueemu.0" });
}

/**
 * The adapter as a start leaves it — the client keys loaded from its data folder, an earlier client moved — and the
 * bridge's routes over it.
 */
async function started(): Promise<{ adapter: ApiHandlerAdapter; routes: Routes }> {
  db.dir = mkdtempSync(join(tmpdir(), "hueemu-guard-h06-"));
  folders.push(db.dir);
  const adapter = new HueEmu();
  const clients = await (adapter as unknown as { prepareClients(): Promise<ClientStore> }).prepareClients();
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
    isClientAllowed: () => !network.foreign,
  });
  const routes = await (server as unknown as { createServer(https: boolean): Promise<Routes> }).createServer(false);
  servers.push(routes);
  return { adapter, routes };
}

/**
 * Open the pairing window with a `startPairing` command, as the admin sends it.
 *
 * @param adapter the adapter
 */
function openWindow(adapter: ApiHandlerAdapter): void {
  const command = { val: true, ack: false, ts: Date.now(), lc: Date.now(), from: "system.adapter.admin.0", q: 0 };
  (adapter as unknown as { onStateChange(id: string, state: unknown): void }).onStateChange(
    "hueemu.0.startPairing",
    command,
  );
}

/**
 * A device pairs inside the window with its text and its own key.
 *
 * @param adapter the adapter
 * @param routes the bridge's routes
 * @param devicetype the text it names
 * @param key its key
 */
async function pair(adapter: ApiHandlerAdapter, routes: Routes, devicetype: string, key: string): Promise<void> {
  openWindow(adapter);
  await routes.inject({ method: "POST", url: "/api", payload: { devicetype, username: key } });
}

/** The client datapoints in the tree, by full id. */
function clientIds(): string[] {
  return [...db.objects.values()]
    .filter(obj => String(obj._id).startsWith("hueemu.0.clients.") && obj.type === "state")
    .map(obj => String(obj._id))
    .sort();
}

describe("H-06: a paired device is named after its device text and the last four characters of its key", () => {
  it("names a paired device after its device text and the last four characters of its key — paired now or before the update", async () => {
    oldClient();
    const { adapter, routes } = await started();
    await pair(adapter, routes, "Harmony Hub", HUB_KEY);

    expect(clientIds()).toEqual(["hueemu.0.clients.harmony-hub-ac37", "hueemu.0.clients.harmony-hub-d3b9"]);
  });

  it("puts client in front for a device that names no text, and a counter behind an id already taken", async () => {
    const { adapter, routes } = await started();
    openWindow(adapter);
    await routes.inject({ method: "GET", url: `/api/${SILENT_KEY}/lights` });
    await pair(adapter, routes, "Harmony Hub", HUB_KEY);
    await pair(adapter, routes, "Harmony Hub", TWIN_KEY);

    expect(clientIds()).toEqual([
      "hueemu.0.clients.client-0001",
      "hueemu.0.clients.harmony-hub-ac37",
      "hueemu.0.clients.harmony-hub-ac37-2",
    ]);
  });

  it("keeps the key only in a file in the instance's data folder — not in the id, the value, the hidden data or the log", async () => {
    oldClient();
    const { adapter, routes } = await started();
    await pair(adapter, routes, "Harmony Hub", HUB_KEY);
    openWindow(adapter);
    await routes.inject({ method: "GET", url: `/api/${SILENT_KEY}/lights` });
    await routes.inject({ method: "GET", url: `/api/${HUB_KEY}` });
    await routes.inject({ method: "GET", url: `/api/${HUB_KEY}/lights` });
    await routes.inject({ method: "GET", url: `/api/${HUB_KEY}/capabilities` });
    await routes.inject({ method: "DELETE", url: `/api/${HUB_KEY}/config/whitelist/${SILENT_KEY}` });
    // An object of the version before whose move failed — its id and value are the key — written and then deleted.
    const onStateChange = (
      adapter as unknown as { onStateChange(id: string, state: unknown): void }
    ).onStateChange.bind(adapter);
    onStateChange(`hueemu.0.clients.${OLD_KEY}`, {
      val: OLD_KEY,
      ack: false,
      ts: 2,
      lc: 2,
      from: "system.adapter.x.0",
    });
    onStateChange(`hueemu.0.clients.${OLD_KEY}`, null);
    // A paired device asking from outside the adapter's networks — refused, and its line names the key all the same.
    network.foreign = true;
    await routes.inject({ method: "GET", url: `/api/${HUB_KEY}/lights` });
    network.foreign = false;
    // A device the window would take in, while the database refuses its object.
    db.refuse = true;
    openWindow(adapter);
    await routes.inject({ method: "GET", url: `/api/${REFUSED_KEY}/lights` });
    db.refuse = false;
    const file = JSON.parse(readFileSync(join(db.dir, "clients.json"), "utf8")) as unknown;
    const tree = JSON.stringify({ objects: [...db.objects], states: [...db.states] });
    const keys = [HUB_KEY, OLD_KEY, SILENT_KEY, REFUSED_KEY];
    const inTree = keys.filter(key => tree.includes(key));
    const inLog = db.logs.filter(line => keys.some(key => line.includes(key)));

    expect({ clients: clientIds(), file, inTree, logged: db.logs.length > 0, inLog }).toEqual({
      clients: [
        "hueemu.0.clients.client-0001",
        "hueemu.0.clients.harmony-hub-ac37",
        "hueemu.0.clients.harmony-hub-d3b9",
      ],
      file: { clients: { "client-0001": SILENT_KEY, "harmony-hub-ac37": HUB_KEY, "harmony-hub-d3b9": OLD_KEY } },
      inTree: [],
      logged: true,
      inLog: [],
    });
  });
});
