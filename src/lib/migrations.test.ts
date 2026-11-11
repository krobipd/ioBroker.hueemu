vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import {
  detectLegacyLightType,
  type LightMigrationStore,
  OBSOLETE_STATE_IDS,
  runLegacyDeviceMigration,
  runLightObjectMigration,
  runObsoleteStateCleanup,
} from "./migrations";
import type { DeviceConfig } from "../hue-api";

describe("runLightObjectMigration (audit R-24)", () => {
  /**
   * A light store in memory: the light objects by number, the mark, and a switch that makes every write fail.
   *
   * @param lights the light numbers that have an object already
   * @param mark the stored mark
   */
  function mkStore(
    lights: number[] = [],
    mark = 0,
  ): LightMigrationStore & { created: DeviceConfig[]; mark: () => number; failWrites: () => void } {
    const created: DeviceConfig[] = [];
    let stored = mark;
    let fail = false;
    return {
      created,
      mark: () => stored,
      failWrites: () => {
        fail = true;
      },
      list: () =>
        Promise.resolve({
          lights: lights.map(id => ({ id, name: `L${id}`, lightType: "onoff" as const })),
          objects: new Map(),
        }),
      readMark: () => ({ mark: stored }),
      writeMark: (m: number) => {
        if (fail) {
          throw new Error("EACCES");
        }
        stored = m;
      },
      create: (light: DeviceConfig & { id: number }) => {
        if (fail) {
          return Promise.reject(new Error("objects db down"));
        }
        created.push(light);
        return Promise.resolve();
      },
    };
  }
  const log = (): { info: string[]; warn: string[]; logger: { info(m: string): void; warn(m: string): void } } => {
    const info: string[] = [];
    const warn: string[] = [];
    return { info, warn, logger: { info: m => info.push(m), warn: m => warn.push(m) } };
  };

  it("moves an unnumbered list by position and stores the mark", async () => {
    const store = mkStore();
    const l = log();
    const result = await runLightObjectMigration(
      store,
      {
        devices: [
          { name: "A", lightType: "onoff", onState: "a" },
          { name: "B", lightType: "onoff", onState: "b" },
        ],
        lastLightId: undefined,
      },
      l.logger,
    );
    expect(result).toEqual({ stored: true });
    expect(store.created.map(d => [d.id, d.name])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
    expect(store.mark()).toBe(2);
    expect(l.info.some(m => m.includes("Moved 2 light(s)"))).toBe(true);
  });

  it("keeps every number and carries the settings' mark", async () => {
    const store = mkStore();
    await runLightObjectMigration(
      store,
      { devices: [{ id: 3, name: "A", lightType: "onoff", onState: "a" }], lastLightId: 8 },
      log().logger,
    );
    expect(store.created.map(d => d.id)).toEqual([3]);
    expect(store.mark()).toBe(8);
  });

  it("creates only the numbers without an object, and the mark covers every number seen", async () => {
    const store = mkStore([1, 9], 2);
    await runLightObjectMigration(
      store,
      {
        devices: [
          { id: 1, name: "A", lightType: "onoff", onState: "a" },
          { id: 2, name: "B", lightType: "onoff", onState: "b" },
        ],
        lastLightId: 2,
      },
      log().logger,
    );
    expect(store.created.map(d => d.id)).toEqual([2]);
    expect(store.mark()).toBe(9);
  });

  it("has nothing to move for an empty list and no mark — the keys may go", async () => {
    const store = mkStore();
    expect(await runLightObjectMigration(store, { devices: [], lastLightId: 0 }, log().logger)).toEqual({
      stored: true,
    });
    expect(store.created).toEqual([]);
  });

  it("stores the mark of a list whose lights were all deleted", async () => {
    const store = mkStore();
    expect(await runLightObjectMigration(store, { devices: [], lastLightId: 5 }, log().logger)).toEqual({
      stored: true,
    });
    expect(store.mark()).toBe(5);
  });

  it("serves the numbered settings' lights when the move fails — nothing is reported stored", async () => {
    const store = mkStore();
    store.failWrites();
    const l = log();
    const result = await runLightObjectMigration(
      store,
      { devices: [{ name: "A", lightType: "onoff", onState: "a" }, null], lastLightId: undefined },
      l.logger,
    );
    expect(result).toEqual({ stored: false, devices: [{ id: 1, name: "A", lightType: "onoff", onState: "a" }] });
    expect(l.warn.some(m => m.includes("EACCES"))).toBe(true);
  });
});

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
      const existing = new Set(["info.configuredDevices"]);
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
      expect(deleted).toContain("info.configuredDevices");
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
      expect(ids).toContain("createLight");
    });

    // v1.17.0: `info` and `info.connection` came BACK as the serving indicator.
    // This cleanup runs after the objects are created, so leaving them on the
    // list would create and delete them again on every single start.
    it("no longer removes the objects the adapter itself creates", () => {
      const ids = OBSOLETE_STATE_IDS.map(o => o.id);
      expect(ids).not.toContain("info");
      expect(ids).not.toContain("info.connection");
      expect(ids).not.toContain("info.error");
    });
  });

  // C1: migrateLegacyDevices extracted from main.ts into this pure helper.
  describe("runLegacyDeviceMigration", () => {
    function mkAdapter(over: Record<string, unknown> = {}): any {
      return {
        namespace: "hueemu.0",
        lightsStored: false,
        getDevicesAsync: () => Promise.resolve([]),
        getStateAsync: () => Promise.resolve(null),
        // A legacy device that was never migrated still carries its `.name` wrapper.
        getObjectAsync: (id: string) => Promise.resolve(id.endsWith(".name") ? { _id: `hueemu.0.${id}` } : null),
        getStatesOfAsync: () => Promise.resolve([]),
        addLights: () => Promise.resolve(),
        delObjectAsync: () => Promise.resolve(null),
        log: { info: () => {}, warn: () => {} },
        ...over,
      };
    }

    it("skips when lights are stored already — even with legacy objects still present", async () => {
      // An install that was already migrated (or configured by hand) keeps its
      // legacy objects until they are cleaned up. Running the migration again
      // would add the old mapping a second time.
      let written: any = null;
      const getDevicesAsync = vi.fn(() => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]));
      const adapter = mkAdapter({
        lightsStored: true,
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
      });
      expect(await runLegacyDeviceMigration({ ...adapter, getDevicesAsync })).toBe(false);
      expect(written, "stored lights must not get the old mapping again").toBeNull();
      expect(getDevicesAsync, "no device object is read on every start").not.toHaveBeenCalled();
    });

    it("skips when there are no legacy device objects", async () => {
      let written: any = null;
      const infos: string[] = [];
      const adapter = mkAdapter({
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
        log: { info: (m: string) => infos.push(m), warn: () => {} },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
      // Nothing found → nothing written and nothing announced. Writing an empty
      // device list here would wipe the config on every start of a fresh install.
      expect(written).toBeNull();
      expect(infos.filter(m => m.includes("legacy device"))).toHaveLength(0);
    });

    it("maps legacy state children to the right type/state ids and stores them as lights", async () => {
      let written: any;
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () =>
          Promise.resolve([
            { _id: "hueemu.0.lamp.state.on" },
            { _id: "hueemu.0.lamp.state.bri" },
            { _id: "hueemu.0.lamp.state.ct" },
          ]),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      // The number comes from the light store (audit R-24), not from the migration.
      expect(written[0]).toMatchObject({
        lightType: "ct",
        onState: "hueemu.0.lamp.state.on",
        briState: "hueemu.0.lamp.state.bri",
        ctState: "hueemu.0.lamp.state.ct",
      });
    });

    // v1.19.0 (audit 2026-09-25 Q17): the migration keeps the device, channel and leaves
    // (the bindings point at the leaves) and deletes only `.name`/`.data`. A device
    // without them was migrated before — taking it again brought back lights the user
    // had deleted, as soon as the list was empty.
    it("does not migrate a device again once its wrappers are gone", async () => {
      let written: any = null;
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getObjectAsync: () => Promise.resolve(null),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
      expect(written).toBeNull();
    });

    it("still migrates a device that only has its .data wrapper left", async () => {
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getObjectAsync: (id: string) => Promise.resolve(id === "lamp.data" ? { _id: "hueemu.0.lamp.data" } : null),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
    });

    // Audit 2026-09-25 Q34: the legacy paths had one test for the mapping — the name
    // fallbacks, xy, a device that fails and "all failed" were never run.
    it("takes the name from the legacy .name state first, then common.name, then the id", async () => {
      let written: any;
      const adapter = mkAdapter({
        getDevicesAsync: () =>
          Promise.resolve([
            { _id: "hueemu.0.a", common: { name: "Common A" } },
            { _id: "hueemu.0.b", common: { name: "Common B" } },
            { _id: "hueemu.0.c", common: { name: { en: "translated" } } },
          ]),
        getStateAsync: (id: string) => Promise.resolve(id === "a.name" ? { val: "State A" } : { val: 42 }),
        getStatesOfAsync: (device: string) => Promise.resolve([{ _id: `hueemu.0.${device}.state.on` }]),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      expect(written.map((d: any) => d.name)).toEqual(["State A", "Common B", "c"]);
    });

    it("maps a legacy xy state and copes with a channel without states", async () => {
      let written: any;
      const adapter = mkAdapter({
        getDevicesAsync: () =>
          Promise.resolve([
            { _id: "hueemu.0.x", common: { name: "X" } },
            { _id: "hueemu.0.e", common: { name: "E" } },
          ]),
        getStatesOfAsync: (device: string) =>
          Promise.resolve(device === "x" ? [{ _id: "hueemu.0.x.state.on" }, { _id: "hueemu.0.x.state.xy" }] : null),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      expect(written[0]).toMatchObject({ name: "X", xyState: "hueemu.0.x.state.xy" });
      expect(written[1]).toMatchObject({ name: "E" });
      expect(written[1].onState).toBeUndefined();
    });

    it("skips a device that fails, and writes nothing when every device failed", async () => {
      const warnings: string[] = [];
      let written: any = null;
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.bad", common: { name: "Bad" } }]),
        getStatesOfAsync: () => Promise.reject(new Error("broker hiccup")),
        addLights: (configs: DeviceConfig[]) => {
          written = configs;
          return Promise.resolve();
        },
        log: { info: () => {}, warn: (m: string) => warnings.push(m) },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
      expect(written).toBeNull();
      expect(warnings.some(w => w.includes("Could not migrate legacy device bad") && w.includes("broker hiccup"))).toBe(
        true,
      );
    });

    it("treats an unreadable wrapper as absent", async () => {
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getObjectAsync: () => Promise.reject(new Error("db down")),
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(false);
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

    // Audit R-24: the lights are stored first — a failed store keeps the wrappers, and the next start tries again.
    it("keeps the wrappers when the lights cannot be stored", async () => {
      const deleted: string[] = [];
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }]),
        getStatesOfAsync: () => Promise.resolve([{ _id: "hueemu.0.lamp.state.on" }]),
        addLights: () => Promise.reject(new Error("objects db down")),
        delObjectAsync: (id: string) => {
          deleted.push(id);
          return Promise.resolve(null);
        },
      });
      await expect(runLegacyDeviceMigration(adapter)).rejects.toThrow("objects db down");
      expect(deleted).toEqual([]);
    });
  });
});
