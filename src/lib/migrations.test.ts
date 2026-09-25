vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import {
  detectLegacyLightType,
  OBSOLETE_STATE_IDS,
  runDeviceIdMigration,
  runLegacyDeviceMigration,
  runObsoleteStateCleanup,
} from "./migrations";
import type { DeviceConfig } from "../hue-api";

describe("runDeviceIdMigration (v1.18.0)", () => {
  function mkAdapter(write: (obj: { native: { devices: DeviceConfig[] } }) => Promise<unknown>): {
    adapter: Parameters<typeof runDeviceIdMigration>[0];
    infos: string[];
    warns: string[];
  } {
    const infos: string[] = [];
    const warns: string[] = [];
    return {
      adapter: {
        namespace: "hueemu.0",
        extendForeignObjectAsync: (_id, obj) => write(obj),
        log: { info: m => infos.push(m), warn: m => warns.push(m) },
      },
      infos,
      warns,
    };
  }

  it("numbers an unnumbered list by position, writes it once and reports the restart", async () => {
    let written: DeviceConfig[] | undefined;
    const { adapter, infos } = mkAdapter(obj => {
      written = obj.native.devices;
      return Promise.resolve();
    });
    const devices: DeviceConfig[] = [
      { name: "A", lightType: "onoff", onState: "a" },
      { name: "B", lightType: "onoff", onState: "b" },
    ];
    expect(await runDeviceIdMigration(adapter, devices)).toBe(true);
    expect(written?.map(d => d.id)).toEqual([1, 2]);
    expect(infos.some(m => m.includes("restarts once"))).toBe(true);
    // The caller's list is untouched on the success path — the restart reads the stored one.
    expect(devices[0].id).toBeUndefined();
  });

  it("writes nothing for a list that is numbered already", async () => {
    let writes = 0;
    const { adapter } = mkAdapter(() => {
      writes++;
      return Promise.resolve();
    });
    const devices: DeviceConfig[] = [
      { id: 3, name: "A", lightType: "onoff", onState: "a" },
      { id: 1, name: "B", lightType: "onoff", onState: "b" },
    ];
    expect(await runDeviceIdMigration(adapter, devices)).toBe(false);
    expect(writes).toBe(0);
  });

  it("numbers the caller's list in place and continues when the write fails", async () => {
    const { adapter, warns } = mkAdapter(() => Promise.reject(new Error("db down")));
    const devices: DeviceConfig[] = [{ name: "A", lightType: "onoff", onState: "a" }];
    expect(await runDeviceIdMigration(adapter, devices)).toBe(false);
    expect(devices[0].id).toBe(1);
    expect(warns[0]).toContain("Light numbers could not be stored");
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
        configuredDevices: [],
        getDevicesAsync: () => Promise.resolve([]),
        getStateAsync: () => Promise.resolve(null),
        // A legacy device that was never migrated still carries its `.name` wrapper.
        getObjectAsync: (id: string) => Promise.resolve(id.endsWith(".name") ? { _id: `hueemu.0.${id}` } : null),
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
        // v1.18.0: numbered on the way, so the id migration has nothing left to
        // write and the instance restarts once, not twice.
        id: 1,
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
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
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
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      expect(written.native.devices.map((d: any) => d.name)).toEqual(["State A", "Common B", "c"]);
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
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
        },
      });
      expect(await runLegacyDeviceMigration(adapter)).toBe(true);
      expect(written.native.devices[0]).toMatchObject({ name: "X", xyState: "hueemu.0.x.state.xy" });
      expect(written.native.devices[1]).toMatchObject({ name: "E" });
      expect(written.native.devices[1].onState).toBeUndefined();
    });

    it("skips a device that fails, and writes nothing when every device failed", async () => {
      const warnings: string[] = [];
      let written: any = null;
      const adapter = mkAdapter({
        getDevicesAsync: () => Promise.resolve([{ _id: "hueemu.0.bad", common: { name: "Bad" } }]),
        getStatesOfAsync: () => Promise.reject(new Error("broker hiccup")),
        extendForeignObjectAsync: (_id: string, obj: any) => {
          written = obj;
          return Promise.resolve(null);
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
  });
});
