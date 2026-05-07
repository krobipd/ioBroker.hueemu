import { expect } from "chai";
import {
  buildInstanceObjectMigrationPatch,
  INSTANCE_OBJECT_MIGRATION_PAIRS,
  OBSOLETE_STATE_IDS,
  runInstanceObjectMigration,
  runObsoleteStateCleanup,
} from "./migrations";

describe("migrations", () => {
  describe("buildInstanceObjectMigrationPatch", () => {
    it("returns name patch when common.name is a string", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: "Start Pairing" },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).to.not.be.null;
      expect(patch!.name).to.be.an("object");
    });

    it("returns desc patch when common.desc is a string", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "x" }, desc: "some plain desc" },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).to.not.be.null;
      expect(patch!.desc).to.be.an("object");
      expect(patch!.name).to.be.undefined;
    });

    it("returns null when name is already an object and no desc", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "x", de: "y" } },
        INSTANCE_OBJECT_MIGRATION_PAIRS[2], // clients (no descKey)
      );
      expect(patch).to.be.null;
    });

    it("returns null for already-migrated objects (idempotent)", () => {
      const patch = buildInstanceObjectMigrationPatch(
        { name: { en: "Start Pairing" }, desc: { en: "Enable pairing" } },
        INSTANCE_OBJECT_MIGRATION_PAIRS[0],
      );
      expect(patch).to.be.null;
    });

    it("returns null when common is undefined", () => {
      const patch = buildInstanceObjectMigrationPatch(undefined, INSTANCE_OBJECT_MIGRATION_PAIRS[0]);
      expect(patch).to.be.null;
    });
  });

  describe("runInstanceObjectMigration", () => {
    it("calls extendObjectAsync only for objects with string common.name", async () => {
      const objects: Record<string, { common?: { name?: unknown; desc?: unknown } }> = {
        startPairing: { common: { name: "startPairing", desc: "Enable pairing mode for 50 seconds" } },
        disableAuth: { common: { name: { en: "Already migrated" }, desc: { en: "ok" } } },
        clients: { common: { name: "Paired Clients" } },
      };
      const calls: Array<{ id: string; patch: unknown }> = [];
      await runInstanceObjectMigration({
        getObjectAsync: async id => objects[id] ?? null,
        extendObjectAsync: async (id, obj) => {
          calls.push({ id, patch: obj.common });
          return null;
        },
        log: { debug: () => {} },
      });

      expect(calls).to.have.lengthOf(2);
      expect(calls[0].id).to.equal("startPairing");
      expect(calls[1].id).to.equal("clients");
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
      expect(calls).to.equal(0);
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
      expect(calls).to.equal(0);
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
      expect(deleted).to.include("info.configuredDevices");
      expect(deleted).to.include("createLight");
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
      expect(deleted).to.include("info.connection");
      expect(deleted).to.include("info");
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
      expect(deleted).to.include("info.configuredDevices");
      expect(deleted).to.not.include("info");
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
      expect(calls).to.equal(0);
    });
  });

  describe("OBSOLETE_STATE_IDS", () => {
    it("includes the documented ids from main.ts history", () => {
      const ids = OBSOLETE_STATE_IDS.map(o => o.id);
      expect(ids).to.include("info.configuredDevices");
      expect(ids).to.include("info.connection");
      expect(ids).to.include("info");
      expect(ids).to.include("createLight");
    });
  });

  describe("INSTANCE_OBJECT_MIGRATION_PAIRS", () => {
    it("covers startPairing, disableAuth, clients", () => {
      const ids = INSTANCE_OBJECT_MIGRATION_PAIRS.map(p => p.id);
      expect(ids).to.deep.equal(["startPairing", "disableAuth", "clients"]);
    });

    it("clients pair has no descKey (folder has no desc)", () => {
      const clients = INSTANCE_OBJECT_MIGRATION_PAIRS.find(p => p.id === "clients");
      expect(clients!.descKey).to.be.undefined;
    });
  });
});
