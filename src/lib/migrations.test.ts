vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import {
  buildInstanceObjectMigrationPatch,
  detectLegacyLightType,
  INSTANCE_OBJECT_MIGRATION_PAIRS,
  OBSOLETE_STATE_IDS,
  runInstanceObjectMigration,
  runLegacyDeviceMigration,
  runObsoleteStateCleanup,
} from "./migrations";

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

  describe("buildInstanceObjectMigrationPatch", () => {
    it("returns a name patch when common.name is still the old English default", () => {
      const patch = buildInstanceObjectMigrationPatch({ name: "Start Pairing" }, INSTANCE_OBJECT_MIGRATION_PAIRS[0]);
      expect(patch).not.toBeNull();
      expect(patch!.name).toBeTypeOf("object");
    });

    it("does NOT patch a user-renamed name (rename preserved)", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: "My Custom Pairing Button" },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).toBeNull();
    });

    it("returns desc patch when common.desc is a string", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "x" }, desc: "some plain desc" },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).not.toBeNull();
      expect(patch!.desc).toBeTypeOf("object");
      expect(patch!.name).toBeUndefined();
    });

    it("returns null when name is already an object and no desc", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "x", de: "y" } },
        INSTANCE_OBJECT_MIGRATION_PAIRS[2], // clients (no descKey)
      );
      expect(patch).toBeNull();
    });

    it("returns null for already-migrated objects (idempotent)", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "Start Pairing" }, desc: { en: "Enable pairing" } },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).toBeNull();
    });

    it("returns null when common is undefined", () => {
      const patch = buildInstanceObjectMigrationPatch(undefined, INSTANCE_OBJECT_MIGRATION_PAIRS[0]);
      expect(patch).toBeNull();
    });
  });

  describe("runInstanceObjectMigration", () => {
    it("calls extendObjectAsync only for objects with string common.name", async () => {
      const objects: Record<string, { common?: { name?: unknown; desc?: unknown } }> = {
        startPairing: { common: { name: "startPairing", desc: "Enable pairing mode for 50 seconds" } },
        disableAuth: { common: { name: { en: "Already migrated" }, desc: { en: "ok" } } },
        clients: { common: { name: "Paired Clients" } },
      };
      const calls: Array<{ id: string; patch: unknown; options: unknown }> = [];
      await runInstanceObjectMigration({
        getObjectAsync: async id => objects[id] ?? null,
        extendObjectAsync: async (id, obj, options) => {
          calls.push({ id, patch: obj.common, options });
          return null;
        },
        log: { debug: () => {} },
      });

      expect(calls).toHaveLength(2);
      expect(calls[0].id).toBe("startPairing");
      expect(calls[1].id).toBe("clients");
    });

    it("translates an old-default name but leaves a user-renamed name untouched", async () => {
      const objects: Record<string, { common?: { name?: unknown } }> = {
        startPairing: { common: { name: "Start Pairing" } }, // old default → translate
        disableAuth: { common: { name: "My Renamed Switch" } }, // user rename → leave alone
        clients: { common: { name: { en: "x" } } }, // already migrated → skip
      };
      const calls: Array<{ id: string; patch: { name?: unknown } }> = [];
      await runInstanceObjectMigration({
        getObjectAsync: async id => objects[id] ?? null,
        extendObjectAsync: async (id, obj) => {
          calls.push({ id, patch: obj.common });
          return null;
        },
        log: { debug: () => {} },
      });

      // Only the old-default name is migrated; the renamed one is left untouched
      // (the gate replaces the old `preserve` option, which used to block the
      // translation itself).
      expect(calls.map(c => c.id)).toEqual(["startPairing"]);
      expect(calls[0].patch.name).toBeTypeOf("object");
    });

    it("skips non-existing objects", async () => {
      let calls = 0;
      await runInstanceObjectMigration({
        getObjectAsync: async () => null,
        extendObjectAsync: async () => {
          calls++;
          return null;
        },
        log: { debug: () => {} },
      });
      expect(calls).toBe(0);
    });

    it("is idempotent (re-run on already-migrated state does nothing)", async () => {
      const migratedObjects: Record<string, { common?: { name?: unknown; desc?: unknown } }> = {
        startPairing: { common: { name: { en: "x" }, desc: { en: "y" } } },
        disableAuth: { common: { name: { en: "x" }, desc: { en: "y" } } },
        clients: { common: { name: { en: "x" } } },
      };
      let calls = 0;
      await runInstanceObjectMigration({
        getObjectAsync: async id => migratedObjects[id] ?? null,
        extendObjectAsync: async () => {
          calls++;
          return null;
        },
        log: { debug: () => {} },
      });
      expect(calls).toBe(0);
    });
  });

  describe("runObsoleteStateCleanup", () => {
    it("deletes obsolete states that exist", async () => {
      const existing = new Set(["info.configuredDevices", "createLight"]);
      const deleted: string[] = [];
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: async id => (existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: async id => {
          deleted.push(id as string);
          return null;
        },
        getObjectListAsync: async () => ({ rows: [{ id: "hueemu.0.info.other" }] }),
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
        getObjectAsync: async id => (existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: async id => {
          deleted.push(id as string);
          return null;
        },
        getObjectListAsync: async () => ({ rows: [] }), // empty parent after delete
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
        getObjectAsync: async id => (existing.has(id) ? { _id: `hueemu.0.${id}` } : null),
        delObjectAsync: async id => {
          deleted.push(id as string);
          return null;
        },
        getObjectListAsync: async () => ({ rows: [{ id: "hueemu.0.info.connection" }] }),
        log: { debug: () => {} },
      });
      expect(deleted).toContain("info.configuredDevices");
      expect(deleted).not.toContain("info");
    });

    it("skips IDs that don't exist", async () => {
      let calls = 0;
      await runObsoleteStateCleanup({
        namespace: "hueemu.0",
        getObjectAsync: async () => null,
        delObjectAsync: async () => {
          calls++;
          return null;
        },
        getObjectListAsync: async () => null,
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

  describe("INSTANCE_OBJECT_MIGRATION_PAIRS", () => {
    it("covers startPairing, disableAuth, clients", () => {
      const ids = INSTANCE_OBJECT_MIGRATION_PAIRS.map(p => p.id);
      expect(ids).toEqual(["startPairing", "disableAuth", "clients"]);
    });

    it("clients pair has no descKey (folder has no desc)", () => {
      const clients = INSTANCE_OBJECT_MIGRATION_PAIRS.find(p => p.id === "clients");
      expect(clients!.descKey).toBeUndefined();
    });
  });

  // C1: migrateLegacyDevices extracted from main.ts into this pure helper.
  describe("runLegacyDeviceMigration", () => {
    function mkAdapter(over: Record<string, unknown> = {}): any {
      return {
        namespace: "hueemu.0",
        configuredDevices: [],
        getDevicesAsync: async () => [],
        getStateAsync: async () => null,
        getStatesOfAsync: async () => [],
        extendForeignObjectAsync: async () => null,
        delObjectAsync: async () => null,
        log: { info: () => {}, warn: () => {} },
        ...over,
      };
    }

    it("skips when devices are already configured", async () => {
      const done = await runLegacyDeviceMigration(mkAdapter({ configuredDevices: [{ name: "X", lightType: "onoff" }] }));
      expect(done).toBe(false);
    });

    it("skips when there are no legacy device objects", async () => {
      expect(await runLegacyDeviceMigration(mkAdapter())).toBe(false);
    });

    it("maps legacy state children to the right type/state ids and persists (restart)", async () => {
      let written: any;
      const adapter = mkAdapter({
        getDevicesAsync: async () => [{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }],
        getStatesOfAsync: async () => [
          { _id: "hueemu.0.lamp.state.on" },
          { _id: "hueemu.0.lamp.state.bri" },
          { _id: "hueemu.0.lamp.state.ct" },
        ],
        extendForeignObjectAsync: async (_id: string, obj: any) => {
          written = obj;
          return null;
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
        getDevicesAsync: async () => [{ _id: "hueemu.0.lamp", common: { name: "Lamp" } }],
        getStatesOfAsync: async () => [{ _id: "hueemu.0.lamp.state.on" }],
        delObjectAsync: async (id: string) => {
          deleted.push(id);
          return null;
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
