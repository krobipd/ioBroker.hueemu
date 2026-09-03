vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import {
  buildDeviceScalePatch,
  detectLegacyLightType,
  OBSOLETE_STATE_IDS,
  runDeviceScaleBackfill,
  runLegacyDeviceMigration,
  runObsoleteStateCleanup,
  type DeviceScaleBackfillAdapter,
} from "./migrations";
import type { DeviceConfig } from "../hue-api";

describe("migrations", () => {
  describe("detectLegacyLightType", () => {
    it("returns color for any colour state (hue/sat/xy)", () => {
      expect(detectLegacyLightType(new Set(["on", "bri", "hue"]))).toBe("color");
      expect(detectLegacyLightType(new Set(["sat"]))).toBe("color");
      expect(detectLegacyLightType(new Set(["xy"]))).toBe("color");
    });

    it("returns ct when ct is present but no colour state", () => {
      expect(detectLegacyLightType(new Set(["on", "bri", "ct"]))).toBe("ct");
    });

    it("prioritises colour over ct", () => {
      expect(detectLegacyLightType(new Set(["ct", "hue"]))).toBe("color");
    });

    it("returns dimmable when only bri is present", () => {
      expect(detectLegacyLightType(new Set(["on", "bri"]))).toBe("dimmable");
    });

    it("prioritises ct over bri", () => {
      expect(detectLegacyLightType(new Set(["bri", "ct"]))).toBe("ct");
    });

    it("returns onoff when no brightness/colour states", () => {
      expect(detectLegacyLightType(new Set(["on"]))).toBe("onoff");
      expect(detectLegacyLightType(new Set())).toBe("onoff");
    });
  });

  describe("runObsoleteStateCleanup", () => {
    it("deletes obsolete states that exist", async () => {
      const existing = new Set(["info.configuredDevices", "createLight"]);
      const deleted: string[] = [];
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: id => Promise.resolve(existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: id => {
          deleted.push(id);
          return Promise.resolve(null);
        },
        getObjectListAsync: () => Promise.resolve({ rows: [{ id: "hueemu.0.info.other" }] }),
        log: { debug: () => {} },
      });
      expect(deleted).toContain("info.configuredDevices");
      expect(deleted).toContain("createLight");
    });

    it("removes empty parent channel after last child deleted", async () => {
      const existing = new Set(["info.connection"]);
      const deleted: string[] = [];
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: id => Promise.resolve(existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: id => {
          deleted.push(id);
          return Promise.resolve(null);
        },
        getObjectListAsync: () => Promise.resolve({ rows: [] }), // empty parent after delete
        log: { debug: () => {} },
      });
      expect(deleted).toContain("info.connection");
      expect(deleted).toContain("info");
    });

    it("does NOT remove parent if siblings remain", async () => {
      const existing = new Set(["info.configuredDevices"]);
      const deleted: string[] = [];
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: id => Promise.resolve(existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: id => {
          deleted.push(id);
          return Promise.resolve(null);
        },
        getObjectListAsync: () => Promise.resolve({ rows: [{ id: "hueemu.0.info.connection" }] }),
        log: { debug: () => {} },
      });
      expect(deleted).toContain("info.configuredDevices");
      expect(deleted).not.toContain("info");
    });

    it("skips IDs that don't exist", async () => {
      let calls = 0;
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: () => Promise.resolve(null),
        delObjectAsync: () => {
          calls++;
          return Promise.resolve(null);
        },
        getObjectListAsync: () => Promise.resolve(null),
        log: { debug: () => {} },
      });
      expect(calls).toBe(0);
    });
  });

  describe("OBSOLETE_STATE_IDS", () => {
    it("includes the documented ids from main.ts history", () => {
      const ids = OBSOLETE_STATE_IDS.map(o => o.id);
      expect(ids).toContain("info.configuredDevices");
      expect(ids).toContain("info.connection");
      expect(ids).toContain("info");
      expect(ids).toContain("createLight");
    });
  });

  // C1: migrateLegacyDevices extracted from main.ts into this pure helper.
  describe("runLegacyDeviceMigration", () => {
    function mkAdapter(over: Record<string, unknown> = {}): any {
      return {
        namespace: "hueemu.0",
        configuredDevices: [],
        getDevicesAsync: () => Promise.resolve([]),
        getStateAsync: () => Promise.resolve(null),
        getStatesOfAsync: () => Promise.resolve([]),
        extendForeignObjectAsync: () => Promise.resolve(null),
        delObjectAsync: () => Promise.resolve(null),
        log: { info: () => {}, warn: () => {} },
        ...over,
      };
    }

    it("skips when devices are already configured — even with legacy objects still present", async () => {
      // An install that was already migrated (or configured by hand) keeps its
      // legacy objects until they are cleaned up. Running the migration again
      // would OVERWRITE the admin configuration with the old mapping.
      let written: any = null;
      const adapter = mkAdapter({
        configuredDevices: [{ name: "X", lightType: "onoff", onState: "x.on" }],
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
      expect(written, "configured devices must not be overwritten").toBeNull();
    });

    it("skips when there are no legacy device objects", async () => {
      let written: any = null;
      const infos: string[] = [];
      const adapter = mkAdapter({
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
        },
        log: { info: (m: string) => infos.push(m), warn: () => {} },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
      // Nothing found → nothing written and nothing announced. Writing an empty
      // device list here would wipe the config on every start of a fresh install.
      expect(written).toBeNull();
      expect(infos.filter(m => m.includes("legacy device"))).toHaveLength(0);
    });

    it("maps legacy state children to the right type/state ids and persists (restart)", async () => {
      let written: any;
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () =>
          Promise.resolve([
            { _id: "hueemu.0.lamp.state.on" },
            { _id: "hueemu.0.lamp.state.bri" },
            { _id: "hueemu.0.lamp.state.ct" },
          ]),
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      expect(written.native.devices[0]).toMatchObject({
        lightType: "ct",
        onState: "hueemu.0.lamp.state.on",
        briState: "hueemu.0.lamp.state.bri",
        ctState: "hueemu.0.lamp.state.ct",
      });
    });

    it("deletes only the obsolete .name/.data wrappers, keeps the containers (L2)", async () => {
      const deleted: string[] = [];
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
        delObjectAsync: (id: string) => {
          deleted.push(id);
          return Promise.resolve(null);
        },
      });
      await runLegacyDeviceMigration(adapter);
      expect(deleted).toContain("lamp.name");
      expect(deleted).toContain("lamp.data");
      expect(deleted).not.toContain("lamp.state");
      expect(deleted).not.toContain("lamp");
    });
  });
});

describe("runDeviceScaleBackfill", () => {
  /**
   * Build the minimum adapter surface, backed by a fixed object map.
   *
   * @param objects The object map the backfill reads its evidence from
   */
  function makeAdapter(objects: Record<string, ioBroker.Object>): {
    adapter: DeviceScaleBackfillAdapter;
    written: DeviceConfig[][];
    info: string[];
  } {
    const written: DeviceConfig[][] = [];
    const info: string[] = [];
    return {
      written,
      info,
      adapter: {
        namespace: "hueemu.0",
        getForeignObjectAsync: id => Promise.resolve(objects[id] ?? null),
        extendForeignObjectAsync: (_id, obj) => {
          written.push(obj.native.devices);
          return Promise.resolve();
        },
        log: { info: m => info.push(m), debug: () => {} },
      },
    };
  }

  /**
   * A writable number state with the given bounds/unit.
   *
   * @param id The full state id
   * @param extras The bounds and unit the source declares
   * @param extras.min Declared `common.min`, if any
   * @param extras.max Declared `common.max`, if any
   * @param extras.unit Declared `common.unit`, if any
   */
  function numState(id: string, extras: { min?: number; max?: number; unit?: string }): ioBroker.Object {
    return {
      _id: id,
      type: "state",
      common: { name: id, type: "number", role: "level", read: true, write: true, ...extras },
      native: {},
    };
  }

  it("does nothing without devices", async () => {
    const { adapter, written } = makeAdapter({});
    expect(await runDeviceScaleBackfill(adapter, [])).toBe(false);
    expect(written).toEqual([]);
  });

  it("fills the scales a bound source proves, and reports the restart", async () => {
    const objects = {
      "z.bri": numState("z.bri", { min: 0, max: 100 }),
      "z.hue": numState("z.hue", { min: 0, max: 360 }),
      "z.sat": numState("z.sat", { unit: "%" }),
    };
    const { adapter, written, info } = makeAdapter(objects);
    const devices: DeviceConfig[] = [
      { name: "Lamp", lightType: "color", briState: "z.bri", hueState: "z.hue", satState: "z.sat" },
    ];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(true);
    expect(written[0][0]).toMatchObject({ briScale: "percent", hueScale: "degrees", satScale: "percent" });
    expect(info[0]).toContain("1 configured light");
  });

  it("never overwrites a scale that is already set", async () => {
    // A value the user picked by hand — or a previous run derived — is the
    // user's decision, and the source may well disagree with it.
    const objects = { "z.hue": numState("z.hue", { min: 0, max: 360 }) };
    const { adapter } = makeAdapter(objects);
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "color", hueState: "z.hue", hueScale: "raw" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(false);
  });

  it("leaves a source that proves nothing alone — the zigbee colour temperature", async () => {
    // No unit, no bounds: the adapter's mired default is what zigbee delivers,
    // so writing "kelvin" here would break a working binding.
    const objects = { "z.ct": numState("z.ct", {}) };
    const { adapter, written } = makeAdapter(objects);
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "ct", ctState: "z.ct" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(false);
    expect(written).toEqual([]);
  });

  it("derives a Kelvin colour temperature when the source declares it", async () => {
    const objects = { "k.ct": numState("k.ct", { min: 2000, max: 6500, unit: "°K" }) };
    const { adapter, written } = makeAdapter(objects);
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "ct", ctState: "k.ct" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(true);
    expect(written[0][0]).toMatchObject({ ctScale: "kelvin" });
  });

  it("survives an object database that throws while reading a source", async () => {
    const written: DeviceConfig[][] = [];
    const adapter: DeviceScaleBackfillAdapter = {
      namespace: "hueemu.0",
      getForeignObjectAsync: () => Promise.reject(new Error("objects db down")),
      extendForeignObjectAsync: (_id, obj) => {
        written.push(obj.native.devices);
        return Promise.resolve();
      },
      log: { info: () => {}, debug: () => {} },
    };
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "dimmable", briState: "z.bri" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(false);
    expect(written).toEqual([]);
  });

  it("tolerates a bound state whose object is gone", async () => {
    const { adapter } = makeAdapter({});
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "dimmable", briState: "missing.id" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(false);
  });

  it("keeps untouched devices in the written list, in order", async () => {
    const objects = { "b.bri": numState("b.bri", { unit: "%" }) };
    const { adapter, written } = makeAdapter(objects);
    const devices: DeviceConfig[] = [
      { name: "Untouched", lightType: "onoff", onState: "a.on" },
      { name: "Patched", lightType: "dimmable", briState: "b.bri" },
    ];
    await runDeviceScaleBackfill(adapter, devices);
    expect(written[0]).toHaveLength(2);
    expect(written[0][0]).toEqual({ name: "Untouched", lightType: "onoff", onState: "a.on" });
    expect(written[0][1]).toMatchObject({ name: "Patched", briScale: "percent" });
  });

  it("is idempotent — a second run has nothing left to do", async () => {
    const objects = { "z.bri": numState("z.bri", { unit: "%" }) };
    const { adapter, written } = makeAdapter(objects);
    const devices: DeviceConfig[] = [{ name: "Lamp", lightType: "dimmable", briState: "z.bri" }];
    expect(await runDeviceScaleBackfill(adapter, devices)).toBe(true);
    expect(await runDeviceScaleBackfill(adapter, written[0])).toBe(false);
  });
});

describe("buildDeviceScalePatch", () => {
  it("has nothing to patch when the device binds no scaled state", () => {
    expect(buildDeviceScalePatch({ name: "x", lightType: "onoff", onState: "a" }, {})).toBeNull();
  });

  it("only patches attributes the device actually binds", () => {
    const patch = buildDeviceScalePatch(
      { name: "x", lightType: "dimmable", briState: "b" },
      { bri: { writable: true, unit: "%" }, hue: { writable: true, max: 360 } },
    );
    expect(patch).toEqual({ briScale: "percent" });
  });
});
