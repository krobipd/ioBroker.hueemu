/**
 * Guard H-07 — a light has no datapoint for its reachability.
 *
 * The register, H-07: "A light has no datapoint for its reachability. Applies to hueemu only."
 * krobi 2026-11-11 14:27, on the question "Is reachable dropped per light?": "2. no, reachable is pointless in this
 * case BECAUSE we only link internal data, so to speak." Accepted by krobi with the page of hueemu's datapoint tree
 * on 2026-11-11 16:59 ("yes").
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

import { FakeAdapter } from "../lib/adapter-fake";
import { LightStore, type LightStoreAdapter } from "../lib/light-store";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/** An object database in memory with the calls the light store makes — the fleet's fake adapter, in English. */
function memoryObjects(): { adapter: LightStoreAdapter; objects: Map<string, ioBroker.Object> } {
  const fake = Object.assign(new FakeAdapter({ name: "hueemu" }), { language: "en" });
  return {
    adapter: fake as unknown as LightStoreAdapter,
    objects: fake.objects as unknown as Map<string, ioBroker.Object>,
  };
}

describe("H-07: a light has no datapoint for its reachability", () => {
  it("writes no reachability datapoint for a light when adding, saving or bringing it to the current form", async () => {
    const { adapter, objects } = memoryObjects();
    const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-h07-"));
    folders.push(folder);
    const store = new LightStore(adapter, folder, "data:image/svg+xml;base64,PHN2Zy8+");
    await store.add([
      { name: "Hall", lightType: "onoff", onState: "javascript.0.hall" },
      { name: "Desk", lightType: "dimmable", briState: "javascript.0.desk" },
    ]);
    await store.save({ id: 1, name: "Hallway", lightType: "onoff", onState: "javascript.0.hall" });
    await store.reconcile(await store.list());
    const reachability = [...objects.values()]
      .filter(obj => /reachable/i.test(obj._id) || /reachable/i.test(String(obj.common?.role)))
      .map(obj => obj._id);

    expect(reachability).toEqual([]);
  });
});
