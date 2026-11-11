/**
 * Guard K14 — a light is reachable only with an assigned datapoint and its switch or brightness present; a missing color
 * datapoint does not count; when the adapter stops, every light is unreachable.
 *
 * The page, K14: "A light shows 'not reachable' when no datapoint is assigned to it or its switch or its brightness is
 * missing. A missing color datapoint does not count. When the adapter stops, all lights are 'not reachable'." Origin:
 * built by the AI when the lights became objects of their own in the object tree.
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) with the bridge's handler over the
 * lights; the bridge answers each light's reachability, the adapter writes `lights.<n>.reachable` and stops.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The stand-in's database. */
const db = vi.hoisted(() => ({
  objects: new Map<string, Record<string, unknown>>(),
  states: new Map<string, Record<string, unknown>>(),
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
      // the guard delivers nothing
    }
    public unsubscribeForeignStates(): void {
      // nothing ends in this guard
    }
    public clearTimeout(): void {
      // no timer runs in this guard
    }
    public clearInterval(): void {
      // no timer runs in this guard
    }
  }
  return {
    Adapter,
    getAbsoluteInstanceDataDir: () => "",
    I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
  };
});

import * as mainModule from "../main";
import { ApiHandler, type ApiHandlerAdapter } from "../hue-api/api-handler";
import type { DeviceConfig } from "../hue-api/device-binding-service";
import { ClientStore } from "../lib/client-store";
import { LightStore, type LightStoreAdapter } from "../lib/light-store";

const { HueEmu } = mainModule as unknown as { HueEmu: new () => ApiHandlerAdapter };

/** The adapter's own fields and steps the guard reaches. */
interface Internals {
  apiHandler: ApiHandler | null;
  lights: LightStore | undefined;
  lightsAreObjects: boolean;
  writeReachability(): void;
  onUnload(callback: () => void): void;
}

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
  db.objects.clear();
  db.states.clear();
});

/**
 * A datapoint in the tree.
 *
 * @param id its id
 * @param type its value type
 * @param val its value
 */
function datapoint(id: string, type: string, val: ioBroker.StateValue): void {
  db.objects.set(id, { _id: id, type: "state", common: { name: id, type, read: true, write: true }, native: {} });
  db.states.set(id, { val, ack: true, ts: 1, lc: 1, from: "system.adapter.javascript.0" });
}

/**
 * The adapter with the bridge's handler serving the given lights, as a start leaves it.
 *
 * @param devices the lights
 */
async function started(devices: DeviceConfig[]): Promise<{ internals: Internals; handler: ApiHandler }> {
  const adapter = new HueEmu();
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k14-"));
  folders.push(folder);
  const clients = new ClientStore(folder);
  clients.load();
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
    devices,
    logger: adapter.log,
    clients,
  });
  await handler.initialize();
  const internals = adapter as unknown as Internals;
  internals.apiHandler = handler;
  return { internals, handler };
}

describe("K14: when a light is reachable", () => {
  it("is reachable only with an assigned datapoint and its switch or brightness present, whatever its color datapoint", async () => {
    datapoint("javascript.0.on", "boolean", true);
    datapoint("javascript.0.level", "number", 40);
    datapoint("javascript.0.colorOn", "boolean", true);
    const { handler } = await started([
      { id: 1, name: "Nothing assigned", lightType: "onoff" },
      { id: 2, name: "Switch", lightType: "onoff", onState: "javascript.0.on" },
      { id: 3, name: "Switch gone", lightType: "onoff", onState: "javascript.0.gone" },
      { id: 4, name: "Brightness", lightType: "dimmable", briState: "javascript.0.level" },
      { id: 5, name: "Brightness gone", lightType: "dimmable", briState: "javascript.0.dimGone" },
      {
        id: 6,
        name: "Color gone",
        lightType: "color",
        onState: "javascript.0.colorOn",
        xyState: "javascript.0.xyGone",
      },
    ]);
    const lights = await handler.getAllLights();
    const reachable = Object.fromEntries(Object.entries(lights).map(([n, light]) => [n, light.state.reachable]));

    expect(reachable).toEqual({ 1: false, 2: true, 3: false, 4: true, 5: false, 6: true });
  });

  it("makes every light unreachable when the adapter stops", async () => {
    datapoint("javascript.0.hall", "boolean", true);
    datapoint("javascript.0.desk", "number", 80);
    const { internals } = await started([
      { id: 1, name: "Hall", lightType: "onoff", onState: "javascript.0.hall" },
      { id: 2, name: "Desk", lightType: "dimmable", briState: "javascript.0.desk" },
    ]);
    // Only its light ids are used here: where each light's reachability datapoint lives.
    internals.lights = new LightStore(internals as unknown as LightStoreAdapter, "", undefined);
    internals.lightsAreObjects = true;
    internals.writeReachability();
    await Promise.resolve();
    const running = [
      db.states.get("hueemu.0.lights.1.reachable")?.val,
      db.states.get("hueemu.0.lights.2.reachable")?.val,
    ];
    await new Promise<void>(resolve => internals.onUnload(resolve));
    const stopped = [
      db.states.get("hueemu.0.lights.1.reachable")?.val,
      db.states.get("hueemu.0.lights.2.reachable")?.val,
    ];

    expect({ running, stopped }).toEqual({ running: [true, true], stopped: [false, false] });
  });
});
