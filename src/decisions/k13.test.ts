/**
 * Guard K13 — a deleted paired device loses its access at once, also when deleted while the adapter was stopped (from
 * the next start).
 *
 * The page, K13: "You delete the entry of a paired Echo in the object tree. From now on the bridge turns that Echo away.
 * Also when you delete it while the adapter is stopped, that holds from the next start." Origin: built by the AI in a
 * code audit.
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in): the object and state events of a
 * deleted client object, and the preparation of the clients at start; the bridge's handler answers who has access.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The stand-in's database and its instance data folder. */
const db = vi.hoisted(() => ({
  objects: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
  folder: "",
}));

vi.mock("@iobroker/adapter-core", () => {
  const full = (id: string): string => (id.startsWith("hueemu.0.") ? id : `hueemu.0.${id}`);
  const noop = (): void => undefined;
  const between = (startkey: string, endkey: string): Array<[string, Record<string, unknown>]> =>
    [...db.objects].filter(([id]) => id >= startkey && id <= endkey).sort(([a], [b]) => a.localeCompare(b));
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
    public getObjectAsync(id: string): Promise<unknown> {
      return Promise.resolve(structuredClone(db.objects.get(full(id)) ?? null));
    }
    public getObjectListAsync(params: { startkey: string; endkey: string }): Promise<unknown> {
      const rows = between(params.startkey, params.endkey).map(([id, value]) => ({
        id,
        value: structuredClone(value),
      }));
      return Promise.resolve({ rows });
    }
    public getStatesOfAsync(folder: string): Promise<unknown[]> {
      const found = between(`hueemu.0.${folder}.`, `hueemu.0.${folder}.香`).map(([, value]) => value);
      return Promise.resolve(structuredClone(found.filter(o => o.type === "state")));
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
    public subscribeForeignStates(): void {
      // nothing is bound in this guard
    }
    public unsubscribeForeignStates(): void {
      // nothing is bound in this guard
    }
  }
  return {
    Adapter,
    getAbsoluteInstanceDataDir: () => db.folder,
    I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
  };
});

import * as mainModule from "../main";
import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import type { ClientStore } from "../lib/client-store";

const { HueEmu } = mainModule as unknown as { HueEmu: new () => ApiHandlerAdapter };

/** The adapter's own handlers and steps the guard calls. */
interface Internals {
  apiHandler: ApiHandler | null;
  onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void;
  onStateChange(id: string, state: ioBroker.State | null | undefined): void;
  prepareClients(): Promise<ClientStore>;
}

afterEach(() => {
  rmSync(db.folder, { recursive: true, force: true });
  db.objects.clear();
  db.states.clear();
});

/**
 * The adapter with the bridge's handler over the given client keys, as a start leaves it.
 *
 * @returns the adapter, its internals and the handler
 */
async function started(): Promise<{ adapter: ApiHandlerAdapter; internals: Internals; handler: ApiHandler }> {
  const adapter = new HueEmu();
  const internals = adapter as unknown as Internals;
  const clients = await internals.prepareClients();
  const handler = new ApiHandler({
    adapter,
    configServiceConfig: {
      identity: {
        udn: "11111111-2222-3333-4444-555555555555",
        mac: "aa:bb:cc:dd:ee:ff",
        bridgeId: "AABBCCFFFEDDEEFF",
        modelId: "BSB002",
        serialNumber: "aabbccddeeff",
      },
      advertiseHost: "192.168.1.10",
    },
    devices: [],
    logger: adapter.log,
    clients,
  });
  await handler.initialize();
  internals.apiHandler = handler;
  return { adapter, internals, handler };
}

/** The stored client keys. */
function storedKeys(): unknown {
  return (JSON.parse(readFileSync(join(db.folder, "clients.json"), "utf8")) as { clients?: unknown }).clients;
}

describe("K13: a deleted paired device loses its access at once", () => {
  it("turns a paired Echo away as soon as its object is deleted", async () => {
    db.folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k13-"));
    const { adapter, internals, handler } = await started();
    adapter.pairingEnabled = true;
    const key = await handler.createUser({ devicetype: "echo#dot" });
    adapter.pairingEnabled = false;
    const before = await handler.isUserAuthenticated(key);
    db.objects.delete("hueemu.0.clients.1");
    db.states.delete("hueemu.0.clients.1");
    internals.onObjectChange("hueemu.0.clients.1", null);
    internals.onStateChange("hueemu.0.clients.1", null);
    const after = await handler.isUserAuthenticated(key);

    expect({ before, after, stored: storedKeys() }).toEqual({ before: true, after: false, stored: {} });
  });

  it("turns a device away from the next start when its object was deleted while the adapter was stopped", async () => {
    db.folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k13-"));
    writeFileSync(
      join(db.folder, "clients.json"),
      JSON.stringify({ lastClientId: 2, clients: { 1: "echo-key", 2: "harmony-key" } }),
    );
    db.objects.set("hueemu.0.clients.2", {
      _id: "hueemu.0.clients.2",
      type: "state",
      common: { name: { en: "harmony" }, type: "string", role: "text", read: true, write: false },
      native: {},
    });
    const { handler } = await started();
    const echo = await handler.isUserAuthenticated("echo-key");
    const harmony = await handler.isUserAuthenticated("harmony-key");

    expect({ echo, harmony, stored: storedKeys() }).toEqual({
      echo: false,
      harmony: true,
      stored: { 2: "harmony-key" },
    });
  });
});
