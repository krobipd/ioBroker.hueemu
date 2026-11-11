/**
 * Guard K15 — lights carry their own number as id in the object tree (`lights.1`, `lights.2` …), not model plus serial.
 *
 * The page, K15: "The lights are called `lights.1`, `lights.2` … in the object tree. The other adapters name a device
 * after its model and the last four characters of its serial number. A light in hueemu has no serial number, and its
 * name may occur twice." Why: "The number is the same as in H-02; the AI chose it as the identifier in the object tree."
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the light store (light-store.ts) over an object database in memory and a data folder in the system's temporary
 * folder.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
}));

import type { DeviceConfig } from "../hue-api/device-binding-service";
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

/**
 * A light with the same name as another and no serial number at all.
 *
 * @param state the datapoint it switches
 */
function lamp(state: string): DeviceConfig {
  return { name: "Lamp", lightType: "onoff", onState: state };
}

describe("K15: lights carry their own number as id in the object tree", () => {
  it("creates the device objects lights.1 and lights.2", async () => {
    const objects = new Map<string, ioBroker.Object>();
    const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k15-"));
    folders.push(folder);
    const store = new LightStore(memoryObjects(objects), folder, undefined);
    await store.add([lamp("javascript.0.left"), lamp("javascript.0.right")]);
    const devices = [...objects.values()].filter(obj => obj.type === "device").map(obj => obj._id);

    expect(devices.sort()).toEqual(["hueemu.0.lights.1", "hueemu.0.lights.2"]);
  });
});
