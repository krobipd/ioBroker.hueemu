/**
 * Guard H-07 — a light has no datapoint for its reachability.
 *
 * The register, H-07: "A light has no datapoint for its reachability. Applies to hueemu only."
 * krobi 2026-11-11 14:27, on the question "Is reachable dropped per light?": "2. no, reachable is pointless in this
 * case BECAUSE we only link internal data, so to speak." Accepted by krobi with the page of hueemu's datapoint tree
 * (Ressourcen/hueemu/baum-2026-11-11e.html) on 2026-11-11 16:59 ("yes").
 *
 * Path: the light store (light-store.ts) over an object database in memory and a data folder in the system's temporary
 * folder — every way a light's objects are written: adding (device manager, scan, the move at start), saving an edit,
 * and the start's pass that brings each light to the current form.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
}));

import { LightStore, type LightStoreAdapter } from "../lib/light-store";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/**
 * An object database in memory with the calls the light store makes.
 *
 * @param objects where the objects land
 */
function memoryObjects(objects: Map<string, ioBroker.Object>): LightStoreAdapter {
  return {
    namespace: "hueemu.0",
    language: "en",
    getObjectListAsync({ startkey, endkey }) {
      const rows = [...objects]
        .filter(([id]) => id >= startkey && id <= endkey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => ({ id, value: structuredClone(value) }));
      return Promise.resolve({ rows });
    },
    getForeignObjectAsync: id => Promise.resolve(structuredClone(objects.get(id) ?? null)),
    setForeignObject(id, obj) {
      objects.set(id, { ...structuredClone(obj), _id: id } as ioBroker.Object);
      return Promise.resolve({ id });
    },
    extendForeignObjectAsync(id, obj) {
      objects.set(id, { ...(objects.get(id) ?? {}), ...structuredClone(obj), _id: id } as ioBroker.Object);
      return Promise.resolve({ id });
    },
    delForeignObjectAsync(id) {
      objects.delete(id);
      return Promise.resolve();
    },
  };
}

describe("H-07: a light has no datapoint for its reachability", () => {
  it("writes no reachability datapoint for a light when adding, saving or bringing it to the current form", async () => {
    const objects = new Map<string, ioBroker.Object>();
    const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-h07-"));
    folders.push(folder);
    const store = new LightStore(memoryObjects(objects), folder, "data:image/svg+xml;base64,PHN2Zy8+");
    await store.add([
      { name: "Hall", lightType: "onoff", onState: "javascript.0.hall" },
      { name: "Desk", lightType: "dimmable", briState: "javascript.0.desk" },
    ]);
    await store.save({ id: 1, name: "Hallway", lightType: "onoff", onState: "javascript.0.hall" });
    await store.reconcile(await store.list());
    const below = [...objects.values()].filter(obj => obj._id.startsWith("hueemu.0.lights."));
    const devices = below.filter(obj => obj.type === "device").map(obj => obj._id);
    const reachability = below
      .filter(obj => /reachable/i.test(obj._id) || /reachable/i.test(String(obj.common?.role)))
      .map(obj => obj._id);

    expect({ devices: devices.sort(), reachability }).toEqual({
      devices: ["hueemu.0.lights.1", "hueemu.0.lights.2"],
      reachability: [],
    });
  });
});
