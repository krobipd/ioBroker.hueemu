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
    it("returns name patch when common.name is a string", () => {
      const patch = buildInstanceObjectMigrationPatch({ name: "Start Pairing" }, INSTANCE_OBJECT_MIGRATION_PAIRS[0]);
      expect(patch).not.toBeNull();
      expect(patch!.name).toBeTypeOf("object");
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

    it("passes preserve option to extendObjectAsync", async () => {
      const objects: Record<string, { common?: { name?: unknown } }> = {
        startPairing: { common: { name: "startPairing" } },
        disableAuth: { common: { name: { en: "x" } } },
        clients: { common: { name: { en: "x" } } },
      };
      const calls: Array<{ options: unknown }> = [];
      await runInstanceObjectMigration({
        getObjectAsync: async id => objects[id] ?? null,
        extendObjectAsync: async (_id, _obj, options) => {
          calls.push({ options });
          return null;
        },
        log: { debug: () => {} },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].options).toEqual({ preserve: { common: ["name"] } });
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
});
