/**
 * Guard H-02 — every light keeps its number for ever: deleting light 1 leaves light 2 as number 2, a new light gets the
 * next number never given (4), never a freed one; the highest number ever given lives in a file in the instance's data
 * folder.
 *
 * krobi 2026-09-15, on the audit's question about fixed light numbers: "A4 stable number yes" (wording from the AI's
 * project note of that day; the conversation is no longer stored). The page, H-02: "You have the lights 1, 2 and 3 and
 * delete light 1. Light 2 stays number 2. A new light gets number 4, never the 1 again."; before "Light 2 slid to number
 * 1, and Alexa switched the wrong lamp." Why: "Alexa knows a lamp by its identifier, not by its name. The highest number
 * ever given is kept in a file in the instance's data folder. So the backup takes it along too."
 * Accepted by krobi with the page of hueemu's core decisions (version 3) on 2026-11-11 07:37 ("Yes, accepted").
 *
 * Path: the light store (light-store.ts) over an object database in memory and a data folder in the system's temporary
 * folder — the store every way of adding or deleting a light goes through (device manager, start).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** A data folder of its own in the system's temporary folder. */
function dataFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-h02-"));
  folders.push(folder);
  return folder;
}

/** An object database in memory with the calls the light store makes. */
function memoryObjects(): LightStoreAdapter {
  const objects = new Map<string, ioBroker.Object>();
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
      const stored = objects.get(id);
      objects.set(id, { ...(stored ?? {}), ...structuredClone(obj), _id: id } as ioBroker.Object);
      return Promise.resolve({ id });
    },
    delForeignObjectAsync(id, options) {
      for (const key of [...objects.keys()]) {
        if (key === id || (options?.recursive === true && key.startsWith(`${id}.`))) {
          objects.delete(key);
        }
      }
      return Promise.resolve();
    },
  };
}

/**
 * A light as the device manager hands it over, without a number.
 *
 * @param name its name
 */
function light(name: string): DeviceConfig {
  return { name, lightType: "onoff", onState: `javascript.0.${name.toLowerCase()}` };
}

describe("H-02: every light keeps its number for ever", () => {
  it("leaves light 2 as number 2 when light 1 is deleted", async () => {
    const store = new LightStore(memoryObjects(), dataFolder(), undefined);
    await store.add([light("Hall"), light("Desk"), light("Porch")]);
    await store.remove(1);
    const { lights } = await store.list();

    expect(lights.map(stored => [stored.id, stored.name])).toEqual([
      [2, "Desk"],
      [3, "Porch"],
    ]);
  });

  it("gives a new light the next number never given, never a freed one", async () => {
    const store = new LightStore(memoryObjects(), dataFolder(), undefined);
    await store.add([light("Hall"), light("Desk"), light("Porch")]);
    await store.remove(1);
    const [fourth] = await store.add([light("Garden")]);
    await store.remove(4);
    const [fifth] = await store.add([light("Attic")]);

    expect([fourth?.id, fifth?.id]).toEqual([4, 5]);
  });

  it("keeps the highest number ever given in a file in the instance's data folder", async () => {
    const objects = memoryObjects();
    const folder = dataFolder();
    const store = new LightStore(objects, folder, undefined);
    await store.add([light("Hall"), light("Desk"), light("Porch")]);
    await store.remove(3);
    const file = JSON.parse(readFileSync(join(folder, "light-ids.json"), "utf8")) as unknown;
    const [next] = await new LightStore(objects, folder, undefined).add([light("Garden")]);

    expect({ file, next: next?.id }).toEqual({ file: { lastLightId: 3 }, next: 4 });
  });
});
