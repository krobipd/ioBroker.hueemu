import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }) },
}));

import type { DeviceConfig } from "../hue-api";
import { mergedWith } from "./known-objects";
import type { LightStoreAdapter } from "./light-store";
import { LIGHT_IDS_FILE, LightIds, LightStore, settingsOf } from "./light-store";

/** A datapoint someone put below a light by hand — the adapter itself creates none there. */
const HAND_MADE = { type: "state", common: { name: "note", type: "string", role: "text" }, native: {} };

const ICON = "data:image/svg+xml;base64,PHN2Zy8+";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hueemu-lights-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * An adapter whose objects live in memory, as the object database keeps them.
 *
 * @param seed the objects there at the start (full id → object)
 */
type Method<K extends keyof LightStoreAdapter> = Mock<Extract<LightStoreAdapter[K], (...args: never[]) => unknown>>;

/** The fake: the adapter methods as spies, and the object database behind them. */
interface FakeAdapter extends LightStoreAdapter {
  db: Map<string, Record<string, unknown>>;
  getObjectListAsync: Method<"getObjectListAsync">;
  getForeignObjectAsync: Method<"getForeignObjectAsync">;
  setForeignObject: Method<"setForeignObject">;
  extendForeignObjectAsync: Method<"extendForeignObjectAsync">;
  delForeignObjectAsync: Method<"delForeignObjectAsync">;
}

function fakeAdapter(seed: Record<string, unknown> = {}): FakeAdapter {
  const db = new Map(Object.entries(structuredClone(seed)) as Array<[string, Record<string, unknown>]>);
  return {
    namespace: "hueemu.0",
    db,
    getObjectListAsync: vi.fn<LightStoreAdapter["getObjectListAsync"]>(q =>
      Promise.resolve({
        rows: [...db]
          .filter(([id]) => id >= q.startkey && id <= q.endkey)
          .map(([id, value]) => ({ id, value: structuredClone(value) })),
      }),
    ),
    getForeignObjectAsync: vi.fn<LightStoreAdapter["getForeignObjectAsync"]>(id =>
      Promise.resolve(structuredClone(db.get(id) ?? null) as ioBroker.Object | null),
    ),
    setForeignObject: vi.fn<LightStoreAdapter["setForeignObject"]>((id, obj) => {
      db.set(id, structuredClone(obj));
      return Promise.resolve({ id });
    }),
    extendForeignObjectAsync: vi.fn<LightStoreAdapter["extendForeignObjectAsync"]>((id, patch) => {
      db.set(id, mergedWith(db.get(id), patch) as Record<string, unknown>);
      return Promise.resolve();
    }),
    delForeignObjectAsync: vi.fn<LightStoreAdapter["delForeignObjectAsync"]>((id, opts) => {
      for (const key of [...db.keys()]) {
        if (key === id || (opts?.recursive && key.startsWith(`${id}.`))) {
          db.delete(key);
        }
      }
      return Promise.resolve();
    }),
  };
}

/**
 * A light's device object as an earlier start or a hand left it.
 *
 * @param name its name (a text or a translation object)
 * @param native its settings
 * @param common more common fields
 */
const device = (name: unknown, native: unknown, common: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "device",
  common: { name, ...common },
  native,
});

const mark = (): unknown =>
  (JSON.parse(readFileSync(join(dir, LIGHT_IDS_FILE), "utf8")) as { lastLightId: unknown }).lastLightId;

describe("LightIds", () => {
  const ids = new LightIds("hueemu.0");

  it("builds the id of a light's device object", () => {
    expect(ids.device(3)).toBe("hueemu.0.lights.3");
  });

  it("reads the number of a device object id only", () => {
    expect(ids.numberOf("hueemu.0.lights.12")).toBe(12);
    expect(ids.numberOf("hueemu.0.lights.12.note")).toBeUndefined();
    expect(ids.numberOf("hueemu.0.lights.0")).toBeUndefined();
    expect(ids.numberOf("hueemu.0.lights.x")).toBeUndefined();
    expect(ids.numberOf("hueemu.1.lights.3")).toBeUndefined();
    expect(ids.numberOf("hueemu.0xlights.3")).toBeUndefined();
  });

  it("covers everything below the folder with one range", () => {
    const { startkey, endkey } = ids.range();
    expect(startkey).toBe("hueemu.0.lights.");
    expect("hueemu.0.lights.999.note" > startkey && "hueemu.0.lights.999.note" < endkey).toBe(true);
    expect("hueemu.0.lightsX" < startkey || "hueemu.0.lightsX" > endkey).toBe(true);
  });
});

describe("settingsOf", () => {
  it("keeps everything but the number and the name", () => {
    expect(settingsOf({ id: 4, name: "Desk", lightType: "dimmable", briState: "d.bri", briScale: "percent" })).toEqual({
      lightType: "dimmable",
      briState: "d.bri",
      briScale: "percent",
    });
  });
});

describe("LightStore.list", () => {
  it("lists the lights by number, named in the system language, else in English", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.10": device({ en: "Hall", de: "Flur" }, { lightType: "onoff", onState: "h.on" }),
      "hueemu.0.lights.2": device({ en: "Desk" }, { lightType: "onoff", onState: "d.on" }),
      "hueemu.0.lights.2.note": HAND_MADE,
    });
    adapter.language = "de";
    const { lights, objects } = await new LightStore(adapter, dir, ICON).list();
    expect(lights).toEqual([
      { id: 2, name: "Desk", lightType: "onoff", onState: "d.on" },
      { id: 10, name: "Flur", lightType: "onoff", onState: "h.on" },
    ]);
    expect([...objects.keys()].sort()).toEqual(["hueemu.0.lights.10", "hueemu.0.lights.2", "hueemu.0.lights.2.note"]);
  });

  // A hand-edited object: no device, no settings object, a name that is no text — the list still loads.
  it("takes only device objects, and a light whose settings are no object with its number and name alone", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.1": device("Plain", ["not", "settings"]),
      "hueemu.0.lights.2": { type: "channel", common: { name: "No device" }, native: {} },
      "hueemu.0.lights.3": device(42, null),
    });
    const { lights } = await new LightStore(adapter, dir, ICON).list();
    expect(lights).toEqual([
      { id: 1, name: "Plain" },
      { id: 3, name: "" },
    ]);
  });

  // The object list hands every row's object as `unknown` — a row without one is neither a light nor an object.
  it("skips a row that carries no object", async () => {
    const desk = device({ en: "Desk" }, { lightType: "onoff", onState: "d.on" });
    const adapter = fakeAdapter({ "hueemu.0.lights.2": desk });
    adapter.getObjectListAsync.mockResolvedValueOnce({
      rows: [
        { id: "hueemu.0.lights.1", value: null },
        { id: "hueemu.0.lights.2", value: desk },
      ],
    });
    const { lights, objects } = await new LightStore(adapter, dir, ICON).list();
    expect(lights.map(l => l.id)).toEqual([2]);
    expect([...objects.keys()]).toEqual(["hueemu.0.lights.2"]);
  });

  it("reads the list with one call over the folder", async () => {
    const adapter = fakeAdapter();
    await new LightStore(adapter, dir, ICON).list();
    expect(adapter.getObjectListAsync).toHaveBeenCalledTimes(1);
    expect(adapter.getObjectListAsync).toHaveBeenCalledWith(new LightIds("hueemu.0").range());
  });
});

describe("LightStore mark", () => {
  it("reads 0 before the first write, and what was written after it", () => {
    const store = new LightStore(fakeAdapter(), dir, ICON);
    expect(store.readMark()).toEqual({ mark: 0 });
    store.writeMark(7);
    expect(store.readMark()).toEqual({ mark: 7 });
  });

  it("reads 0 and the reason for a file it cannot use", () => {
    writeFileSync(join(dir, LIGHT_IDS_FILE), "{ broken");
    const store = new LightStore(fakeAdapter(), dir, ICON);
    expect(store.readMark().mark).toBe(0);
    expect(store.readMark().error).toMatch(/no JSON/);
    writeFileSync(join(dir, LIGHT_IDS_FILE), JSON.stringify({ lastLightId: "9" }));
    expect(store.readMark()).toEqual({ mark: 0 });
  });

  it("raises the mark only above it", () => {
    const store = new LightStore(fakeAdapter(), dir, ICON);
    store.writeMark(5);
    expect(store.raiseMark([2, 4])).toBe(false);
    expect(mark()).toBe(5);
    expect(store.raiseMark([2, 9])).toBe(true);
    expect(mark()).toBe(9);
    expect(store.raiseMark([])).toBe(false);
  });
});

describe("LightStore.add", () => {
  it("numbers above every number in use and ever handed out, stores the mark, then the objects", async () => {
    const adapter = fakeAdapter({ "hueemu.0.lights.3": device({ en: "A" }, { lightType: "onoff", onState: "a" }) });
    const store = new LightStore(adapter, dir, ICON);
    store.writeMark(6);
    const added = await store.add([
      { name: "B", lightType: "onoff", onState: "b" },
      { name: "C", lightType: "ct", onState: "c", ctState: "c.ct" },
    ]);
    expect(added.map(l => l.id)).toEqual([7, 8]);
    expect(mark()).toBe(8);
    expect(adapter.db.get("hueemu.0.lights.8")).toEqual({
      type: "device",
      common: {
        name: expect.objectContaining({ en: "C", de: "C", "zh-cn": "C" }) as unknown,
        icon: ICON,
      },
      native: { lightType: "ct", onState: "c", ctState: "c.ct" },
    });
    // krobi 2026-11-11 14:27: a light only links datapoints of the same installation — nothing hangs below it.
    expect([...adapter.db.keys()].filter(id => id.startsWith("hueemu.0.lights.8."))).toEqual([]);
  });

  it("creates no object when the mark cannot be stored", async () => {
    const adapter = fakeAdapter();
    const blocked = join(dir, "file");
    writeFileSync(blocked, "");
    const store = new LightStore(adapter, join(blocked, "hueemu.0"), ICON);
    await expect(store.add([{ name: "B", lightType: "onoff", onState: "b" }])).rejects.toThrow();
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty list", async () => {
    const adapter = fakeAdapter();
    expect(await new LightStore(adapter, dir, ICON).add([])).toEqual([]);
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
    expect(() => mark()).toThrow();
  });

  it("leaves the pictogram out when its file could not be read", async () => {
    const adapter = fakeAdapter();
    await new LightStore(adapter, dir, undefined).add([{ name: "B", lightType: "onoff", onState: "b" }]);
    expect(adapter.db.get("hueemu.0.lights.1")?.common).not.toHaveProperty("icon");
  });

  it("hands changes that run at the same time distinct numbers", async () => {
    const adapter = fakeAdapter();
    const store = new LightStore(adapter, dir, ICON);
    const [a, b] = await Promise.all([
      store.add([{ name: "A", lightType: "onoff", onState: "a" }]),
      store.add([{ name: "B", lightType: "onoff", onState: "b" }]),
    ]);
    expect([a[0].id, b[0].id]).toEqual([1, 2]);
  });

  it("runs the next change after a failed one", async () => {
    const adapter = fakeAdapter();
    const store = new LightStore(adapter, dir, ICON);
    adapter.setForeignObject.mockRejectedValueOnce(new Error("db down"));
    await expect(store.add([{ name: "A", lightType: "onoff", onState: "a" }])).rejects.toThrow("db down");
    const [b] = await store.add([{ name: "B", lightType: "onoff", onState: "b" }]);
    expect(b.id).toBe(2);
  });
});

describe("LightStore.save", () => {
  const stored = device(
    { en: "Lamp", de: "Lampe" },
    { lightType: "color", onState: "l.on", hueState: "l.hue" },
    {
      icon: ICON,
      statusStates: { onlineId: "hueemu.0.lights.4.reachable" },
      color: "#ff0000",
    },
  );

  it("writes the object back whole: settings replaced, the rest of it kept", async () => {
    const adapter = fakeAdapter({ "hueemu.0.lights.4": { ...stored, acl: { owner: "system.user.admin" } } });
    adapter.language = "de";
    const saved = await new LightStore(adapter, dir, ICON).save({
      id: 4,
      name: "Lampe",
      lightType: "onoff",
      onState: "l.on",
    });
    expect(saved).toBe(true);
    expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    expect(adapter.db.get("hueemu.0.lights.4")).toEqual({
      type: "device",
      common: {
        name: { en: "Lamp", de: "Lampe" },
        icon: ICON,
        statusStates: { onlineId: "hueemu.0.lights.4.reachable" },
        color: "#ff0000",
      },
      native: { lightType: "onoff", onState: "l.on" },
      acl: { owner: "system.user.admin" },
    });
  });

  it("writes a new name in every language", async () => {
    const adapter = fakeAdapter({ "hueemu.0.lights.4": stored });
    await new LightStore(adapter, dir, ICON).save({ id: 4, name: "Desk", lightType: "onoff", onState: "l.on" });
    expect((adapter.db.get("hueemu.0.lights.4")?.common as { name: Record<string, string> }).name).toMatchObject({
      en: "Desk",
      de: "Desk",
    });
  });

  it("saves nothing for a light that is gone, or an object that is no light", async () => {
    const adapter = fakeAdapter({ "hueemu.0.lights.5": { type: "channel", common: { name: "x" }, native: {} } });
    const store = new LightStore(adapter, dir, ICON);
    expect(await store.save({ id: 4, name: "A", lightType: "onoff" })).toBe(false);
    expect(await store.save({ id: 5, name: "A", lightType: "onoff" })).toBe(false);
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
  });
});

describe("LightStore.remove", () => {
  it("covers the number with the mark first, then deletes the light with everything below it", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.4": device({ en: "A" }, {}),
      "hueemu.0.lights.4.note": HAND_MADE,
    });
    await new LightStore(adapter, dir, ICON).remove(4);
    expect(mark()).toBe(4);
    expect(adapter.delForeignObjectAsync).toHaveBeenCalledWith("hueemu.0.lights.4", { recursive: true });
    expect([...adapter.db.keys()]).toEqual([]);
  });

  it("deletes nothing when the mark cannot be stored", async () => {
    const adapter = fakeAdapter({ "hueemu.0.lights.4": device({ en: "A" }, {}) });
    const blocked = join(dir, "file");
    writeFileSync(blocked, "");
    await expect(new LightStore(adapter, join(blocked, "x"), ICON).remove(4)).rejects.toThrow();
    expect(adapter.delForeignObjectAsync).not.toHaveBeenCalled();
  });
});

describe("LightStore.reconcile", () => {
  const ids = new LightIds("hueemu.0");

  it("gives a light from before its pictogram — name and settings stay, nothing is created below it", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.3": device({ en: "Desk" }, { lightType: "onoff", onState: "d.on" }),
    });
    const store = new LightStore(adapter, dir, ICON);
    expect(await store.reconcile(await store.list())).toBe(1);
    expect(adapter.db.get(ids.device(3))).toEqual(
      device({ en: "Desk" }, { lightType: "onoff", onState: "d.on" }, { icon: ICON }),
    );
    expect([...adapter.db.keys()]).toEqual([ids.device(3)]);
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
  });

  it("writes nothing for lights in the current form", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.3": device({ en: "Desk" }, { lightType: "onoff", onState: "d.on" }),
    });
    const store = new LightStore(adapter, dir, ICON);
    await store.reconcile(await store.list());
    adapter.setForeignObject.mockClear();
    adapter.extendForeignObjectAsync.mockClear();
    expect(await store.reconcile(await store.list())).toBe(0);
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
    expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("keeps a stored pictogram when the file could not be read", async () => {
    const adapter = fakeAdapter({
      "hueemu.0.lights.3": device({ en: "Desk" }, {}, { icon: "data:old" }),
    });
    const store = new LightStore(adapter, dir, undefined);
    expect(await store.reconcile(await store.list())).toBe(0);
    expect((adapter.db.get(ids.device(3))?.common as { icon: string }).icon).toBe("data:old");
  });
});

// The light list as the device manager and the adapter both read it: the same numbers and names.
describe("a light round trip", () => {
  it("lists what it added, numbered and named", async () => {
    const adapter = fakeAdapter();
    const store = new LightStore(adapter, dir, ICON);
    const light: DeviceConfig = { name: "Kitchen", lightType: "dimmable", briState: "k.bri", briScale: "percent" };
    await store.add([light]);
    expect((await store.list()).lights).toEqual([{ id: 1, ...light }]);
  });
});
