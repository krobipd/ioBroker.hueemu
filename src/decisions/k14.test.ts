/**
 * Guard K14 — the bridge reports a light to a paired device as "not reachable" when no datapoint is assigned to it or
 * the datapoint that switches it is missing (the switch; without a switch, the brightness); a missing color datapoint
 * does not count.
 *
 * The register, K14: "The bridge reports a light to a paired device as 'not reachable' when no datapoint is assigned to
 * it or the datapoint that switches it is missing (the switch; without a switch, the brightness). A missing color
 * datapoint does not count." Origin: built by the AI in two audits in September 2026. Its third sentence ("When the
 * adapter stops, all lights are 'not reachable'") was about the datapoint `lights.<n>.reachable`, which H-07 leaves out
 * (krobi 2026-11-11 14:27: "no, reachable is pointless in this case BECAUSE we only link internal data, so to speak").
 * Accepted by krobi with the page of hueemu's datapoint tree (Ressourcen/hueemu/baum-2026-11-11e.html) on 2026-11-11
 * 16:59 ("yes").
 *
 * Path: the adapter itself (main.ts, adapter-core replaced by an in-memory stand-in) with the bridge's handler over the
 * lights; the bridge answers each light's `reachable` field.
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

const { HueEmu } = mainModule as unknown as { HueEmu: new () => ApiHandlerAdapter };

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
async function started(devices: DeviceConfig[]): Promise<{ handler: ApiHandler }> {
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
  return { handler };
}

describe("K14: when the bridge reports a light as not reachable", () => {
  it("reports a light as not reachable when nothing is assigned or the datapoint that switches it is missing", async () => {
    datapoint("javascript.0.on", "boolean", true);
    datapoint("javascript.0.level", "number", 40);
    const { handler } = await started([
      { id: 1, name: "Nothing assigned", lightType: "onoff" },
      { id: 2, name: "Switch", lightType: "onoff", onState: "javascript.0.on" },
      { id: 3, name: "Switch gone", lightType: "onoff", onState: "javascript.0.gone" },
      { id: 4, name: "Brightness", lightType: "dimmable", briState: "javascript.0.level" },
      { id: 5, name: "Brightness gone", lightType: "dimmable", briState: "javascript.0.dimGone" },
      {
        id: 6,
        name: "Switch, brightness gone",
        lightType: "dimmable",
        onState: "javascript.0.on",
        briState: "javascript.0.dimGone",
      },
      {
        id: 7,
        name: "Switch gone, brightness",
        lightType: "dimmable",
        onState: "javascript.0.gone",
        briState: "javascript.0.level",
      },
    ]);
    const lights = await handler.getAllLights();
    const reachable = Object.fromEntries(Object.entries(lights).map(([n, light]) => [n, light.state.reachable]));

    expect(reachable).toEqual({ 1: false, 2: true, 3: false, 4: true, 5: false, 6: true, 7: false });
  });

  it("does not count a missing color datapoint", async () => {
    datapoint("javascript.0.colorOn", "boolean", true);
    datapoint("javascript.0.ctOn", "boolean", true);
    const { handler } = await started([
      {
        id: 1,
        name: "Color gone",
        lightType: "color",
        onState: "javascript.0.colorOn",
        hueState: "javascript.0.hueGone",
        satState: "javascript.0.satGone",
        xyState: "javascript.0.xyGone",
      },
      {
        id: 2,
        name: "Color temperature gone",
        lightType: "ct",
        onState: "javascript.0.ctOn",
        ctState: "javascript.0.ctGone",
      },
    ]);
    const lights = await handler.getAllLights();
    const reachable = Object.fromEntries(Object.entries(lights).map(([n, light]) => [n, light.state.reachable]));

    expect(reachable).toEqual({ 1: true, 2: true });
  });
});
