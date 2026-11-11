/**
 * Tests for UserService — pairing, authentication, client storage
 */

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_DEVICETYPE_LENGTH, UserService, type UserServiceAdapter } from "./user-service";
import { CLIENTS_FILE, ClientStore } from "../lib/client-store";
import { createMockLogger } from "../../test/test-helpers";

interface MockUserAdapter extends UserServiceAdapter {
  stateValues: Record<string, ioBroker.State>;
  writtenObjects: Map<string, ioBroker.SettableObject>;
  writtenStates: Map<string, ioBroker.SettableState>;
  stateObjects: ioBroker.StateObject[];
  setObjectShouldFail: boolean;
  setStateShouldFail: boolean;
  getStatesShouldFail: boolean;
}

/** The instance data folder of one test — clients.json lives there. */
let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "hueemu-clients-"));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** The table clients.json holds right now. */
function storedFile(): { lastClientId: number; clients: Record<string, string> } {
  return JSON.parse(readFileSync(join(dataDir, CLIENTS_FILE), "utf8")) as {
    lastClientId: number;
    clients: Record<string, string>;
  };
}

/**
 * A client store holding the given keys as clients 1, 2, … (as a start finds them after the move).
 *
 * @param keys the keys
 */
function storeWith(keys: string[]): ClientStore {
  const store = new ClientStore(dataDir);
  store.load();
  for (const key of keys) {
    store.add(key);
  }
  return store;
}

/**
 * An adapter whose tree holds one object `clients.<n>` per given key — the keys themselves stand in the store.
 *
 * @param existingKeys the keys of the clients already paired
 */
function createMockAdapter(existingKeys: string[] = []): MockUserAdapter {
  const writtenObjects = new Map<string, ioBroker.SettableObject>();
  const writtenStates = new Map<string, ioBroker.SettableState>();
  const namespace = "hueemu.0";

  const stateObjects: ioBroker.StateObject[] = existingKeys.map(
    (key, i) =>
      ({
        _id: `${namespace}.clients.${i + 1}`,
        type: "state",
        common: { name: { en: `device of ${key}` }, type: "string", role: "text", read: true, write: false },
        native: {},
      }) as unknown as ioBroker.StateObject,
  );

  const adapter: MockUserAdapter = {
    namespace,
    log: {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as ioBroker.Logger,
    writtenObjects,
    writtenStates,
    stateObjects,
    setObjectShouldFail: false,
    setStateShouldFail: false,
    getStatesShouldFail: false,
    setObjectNotExistsAsync: (id, obj) => {
      if (adapter.setObjectShouldFail) {
        return Promise.reject(new Error("setObjectNotExistsAsync failure"));
      }
      writtenObjects.set(id, obj);
      return Promise.resolve({ id });
    },
    setState: (id, state) => {
      if (adapter.setStateShouldFail) {
        return Promise.reject(new Error("setState failure"));
      }
      writtenStates.set(id, state);
      return Promise.resolve({ id });
    },
    getStatesOfAsync: () => {
      if (adapter.getStatesShouldFail) {
        return Promise.reject(new Error("getStatesOfAsync failure"));
      }
      return Promise.resolve(stateObjects);
    },
    stateValues: {},
    getStatesAsync: () => Promise.resolve(structuredClone(adapter.stateValues)),
  };

  return adapter;
}

function createService(existingKeys: string[] = []): {
  service: UserService;
  adapter: MockUserAdapter;
  store: ClientStore;
} {
  const adapter = createMockAdapter(existingKeys);
  const store = storeWith(existingKeys);
  const service = new UserService({ adapter, logger: createMockLogger(), store });
  return { service, adapter, store };
}

describe("UserService", () => {
  describe("addUser", () => {
    it("stores at most 100 chars of the devicetype as the object name", async () => {
      const { service, adapter } = createService();
      await service.addUser("long-name-client", "x".repeat(300));
      expect((adapter.writtenObjects.get("clients.1")?.common?.name as Record<string, string>).en).toHaveLength(
        MAX_DEVICETYPE_LENGTH,
      );
    });

    it("creates the first client as clients.1, named after its device type", async () => {
      const { service, adapter } = createService();
      await service.addUser("alexa-echo-1", "Amazon Echo");
      expect([...adapter.writtenObjects.keys()]).toEqual(["clients.1"]);
      expect(adapter.writtenObjects.get("clients.1")?.common?.name).toMatchObject({
        en: "Amazon Echo",
        de: "Amazon Echo",
      });
    });

    it("numbers the clients one after the other", async () => {
      const { service, adapter } = createService(["first", "second"]);
      await service.addUser("third", "Echo");
      expect([...adapter.writtenObjects.keys()]).toEqual(["clients.3"]);
    });

    // Werkbank standard of round 173 (point 4 and its addendum): a generated secret stands only in the file in the
    // instance data folder — never in an object id, never in common or native. Up to v1.19.0 the key was all three.
    it("keeps the key only in clients.json — the object carries nothing of it", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      expect(JSON.stringify([...adapter.writtenObjects])).not.toContain("user.with.dots");
      expect(JSON.stringify([...adapter.writtenObjects])).not.toContain("user_with_dots");
      expect(adapter.writtenObjects.get("clients.1")?.native).toEqual({});
      expect(storedFile()).toEqual({ lastClientId: 1, clients: { 1: "user.with.dots" } });
    });

    it("defaults devicetype to 'unknown'", async () => {
      const { service, adapter } = createService();
      await service.addUser("abc123");
      expect(adapter.writtenObjects.get("clients.1")?.common?.name).toMatchObject({ en: "unknown" });
    });

    it("stores the device type as the state value, never the key", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      expect(adapter.writtenStates.get("clients.1")).toEqual({ ack: true, val: "test" });
    });

    // Audit R-33 (fleet rule GV-05, inventory test "rewrites no state unchanged"): the value is written once at pairing —
    // a client pairing again under the same key changes nothing, so nothing is written, and the state's last change
    // stays the pairing time (audit R-07).
    it("writes a re-pairing client's state no second time", async () => {
      const { service, adapter } = createService();
      const setState = vi.spyOn(adapter, "setState");
      await service.createUser("known-key", "Echo");
      await service.createUser("known-key", "Echo");
      expect(setState).toHaveBeenCalledTimes(1);
    });

    it("writes no state for a client paired before this start that pairs again", async () => {
      const { service, adapter } = createService(["known-key"]);
      adapter.stateValues = {
        "hueemu.0.clients.1": { val: "Echo", ack: true, ts: 1, lc: 1, from: "system.adapter.hueemu.0", q: 0 },
      };
      const setState = vi.spyOn(adapter, "setState");
      await service.createUser("known-key", "Echo");
      expect(setState).not.toHaveBeenCalled();
    });

    it("pairs a client anew under a new number after its object was deleted", async () => {
      const { service, adapter } = createService();
      const setState = vi.spyOn(adapter, "setState");
      await service.createUser("known-key", "Echo");
      service.forgetClient("1");
      await service.createUser("known-key", "Echo");
      expect(setState).toHaveBeenCalledTimes(2);
      // A number is never handed out twice — the new pairing inherits nothing of the deleted one.
      expect(setState).toHaveBeenLastCalledWith("clients.2", { ack: true, val: "Echo" });
      expect(storedFile()).toEqual({ lastClientId: 2, clients: { 2: "known-key" } });
    });

    // The clients folder is a manifest object that js-controller applies on every
    // start; a runtime copy of its shape is a second source that drifts
    // (iobroker-adapter-checks instance-objects-refresh).
    it("writes no clients folder — the manifest owns it", async () => {
      const { service, adapter } = createService();
      await service.addUser("foo", "bar");
      expect(adapter.writtenObjects.has("clients")).toBe(false);
      expect(adapter.writtenObjects.has("clients.1")).toBe(true);
    });

    // v1.17.0 (audit 2026-09-06 F2): a pairing that never reached the database
    // used to be reported as success. The client then worked until the next
    // adapter start and silently lost access.
    it("refuses the pairing when the client object cannot be stored", async () => {
      const { service, adapter } = createService();
      adapter.setObjectShouldFail = true;
      await expect(service.addUser("foo", "bar")).rejects.toThrow(/could not be stored/i);
    });

    it("takes the key back out of clients.json when the object cannot be stored", async () => {
      const { service, adapter, store } = createService();
      adapter.setObjectShouldFail = true;
      await expect(service.addUser("foo", "bar")).rejects.toThrow();
      expect(store.numberOf("foo")).toBeUndefined();
      expect(storedFile().clients).toEqual({});
    });

    it("refuses the pairing and creates no object when clients.json cannot be written", async () => {
      const blocked = join(dataDir, "not-a-folder");
      writeFileSync(blocked, "");
      const adapter = createMockAdapter();
      const warn = vi.fn();
      const store = new ClientStore(blocked);
      store.load();
      const service = new UserService({ adapter, logger: { ...createMockLogger(), warn }, store });
      await expect(service.addUser("foo", "bar")).rejects.toThrow(/could not be stored/i);
      expect(adapter.writtenObjects.size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to store the key of a new client"));
      expect(await service.isUserAuthenticated("foo")).toBe(false);
    });

    it("does not authenticate a client whose object write failed", async () => {
      const { service, adapter } = createService();
      adapter.setObjectShouldFail = true;
      await expect(service.addUser("ghost", "Echo")).rejects.toThrow();
      expect(await service.isUserAuthenticated("ghost")).toBe(false);
      expect(service.listPairedClients().map(c => c.key)).not.toContain("ghost");
    });

    it("keeps a stored client paired and warns when only its state write fails", async () => {
      const adapter = createMockAdapter();
      const warn = vi.fn();
      const service = new UserService({ adapter, logger: { ...createMockLogger(), warn }, store: storeWith([]) });
      adapter.setStateShouldFail = true;
      await expect(service.addUser("foo", "bar")).resolves.toBeUndefined();
      // The object reached the database — that is what makes a pairing.
      expect(await service.isUserAuthenticated("foo")).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Failed to set client state clients.1"));
    });
  });

  describe("createUser", () => {
    it("returns the provided username if non-empty", async () => {
      const { service } = createService();
      const result = await service.createUser("my-username", "test");
      expect(result).toBe("my-username");
    });

    it("generates a UUID when no username is provided", async () => {
      const { service } = createService();
      const result = await service.createUser(undefined, "test");
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("generates a UUID when username is empty string", async () => {
      const { service } = createService();
      const result = await service.createUser("", "test");
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toBe("");
    });

    it("defaults devicetype to 'unknown'", async () => {
      const { service, adapter } = createService();
      await service.createUser("user1");
      expect(adapter.writtenObjects.get("clients.1")?.common?.name).toMatchObject({ en: "unknown" });
    });
  });

  describe("isUserAuthenticated", () => {
    it("returns false when no clients exist", async () => {
      const { service } = createService([]);
      expect(await service.isUserAuthenticated("anyone")).toBe(false);
    });

    it("returns true for a paired client", async () => {
      const { service } = createService(["alexa-123"]);
      expect(await service.isUserAuthenticated("alexa-123")).toBe(true);
    });

    it("returns false for unknown username", async () => {
      const { service } = createService(["alexa-123"]);
      expect(await service.isUserAuthenticated("unknown-user")).toBe(false);
    });

    // v1.17.0 (audit 2026-09-06 F3, decision 22): authentication compares the REAL
    // key. Matching a sanitized form made every character a key holds that is not
    // [A-Za-z0-9-_] a wildcard.
    it("does not accept a key that merely sanitizes to a paired one", async () => {
      const { service } = createService([]);
      await service.addUser("living.room", "Echo");
      expect(await service.isUserAuthenticated("living.room")).toBe(true);
      expect(await service.isUserAuthenticated("living_room")).toBe(false);
      expect(await service.isUserAuthenticated("living+room")).toBe(false);
    });

    // No id is derived from a key any more — two keys an id could not tell apart are two clients.
    it("pairs two keys that differ only in characters an id cannot hold as two clients", async () => {
      const { service, adapter } = createService([]);
      await service.addUser("living.room", "Echo");
      await service.addUser("living+room", "Harmony");
      expect([...adapter.writtenObjects.keys()]).toEqual(["clients.1", "clients.2"]);
      expect(await service.isUserAuthenticated("living.room")).toBe(true);
      expect(await service.isUserAuthenticated("living+room")).toBe(true);
    });

    // client-store.ts: the object is the truth of "paired" — a key counts only while its object exists AND the file
    // holds it for that number.
    it("signs in only a key whose object exists and whose number the file holds", async () => {
      const adapter = createMockAdapter(["a"]);
      adapter.stateObjects.push({
        _id: "hueemu.0.clients.3",
        type: "state",
        common: { name: { en: "keyless" } },
        native: {},
      } as unknown as ioBroker.StateObject);
      const service = new UserService({ adapter, logger: createMockLogger(), store: storeWith(["a", "b"]) });
      expect(await service.isUserAuthenticated("a")).toBe(true);
      // b: in the file, but its object clients.2 is gone (deleted while the adapter was stopped)
      expect(await service.isUserAuthenticated("b")).toBe(false);
      // clients.3: an object without a key — its number signs nothing in
      expect(await service.isUserAuthenticated("3")).toBe(false);
      expect(service.listPairedClients().map(c => c.key)).toEqual(["a"]);
    });

    it("signs in no key that stands in an object id or in native", async () => {
      const adapter = createMockAdapter();
      adapter.stateObjects.push({
        _id: "hueemu.0.clients.legacy-key",
        type: "state",
        common: { name: "Echo" },
        native: { username: "legacy-key" },
      } as unknown as ioBroker.StateObject);
      const service = new UserService({ adapter, logger: createMockLogger(), store: storeWith([]) });
      expect(await service.isUserAuthenticated("legacy-key")).toBe(false);
    });

    it("returns false when getStatesOfAsync throws", async () => {
      const { service, adapter } = createService(["foo"]);
      adapter.getStatesShouldFail = true;
      expect(await service.isUserAuthenticated("foo")).toBe(false);
    });

    it("retries the broker on the next call after a transient load failure (no cache poisoning)", async () => {
      const { service, adapter } = createService(["foo"]);
      adapter.getStatesShouldFail = true;
      // First call fails to load — must NOT cache the empty set
      expect(await service.isUserAuthenticated("foo")).toBe(false);
      // Broker recovers; the next call retries instead of staying poisoned
      adapter.getStatesShouldFail = false;
      expect(await service.isUserAuthenticated("foo")).toBe(true);
    });

    it("returns false for empty username string", async () => {
      const { service } = createService(["foo"]);
      expect(await service.isUserAuthenticated("")).toBe(false);
    });
  });

  describe("no limit for pairings (decisions K6 and K3)", () => {
    it("adds a 65th client in one window and a 101st within one hour, warning about none", async () => {
      const adapter = createMockAdapter();
      const warn = vi.fn();
      const service = new UserService({ adapter, logger: { ...createMockLogger(), warn }, store: storeWith([]) });
      for (let i = 0; i < 65; i++) {
        await service.addUser(`auto-${i}`, "echo");
      }
      for (let i = 0; i < 36; i++) {
        await service.createUser(`manual-${i}`, "harmony");
      }
      expect(adapter.writtenObjects.size).toBe(101);
      expect(await service.isUserAuthenticated("auto-64")).toBe(true);
      expect(await service.isUserAuthenticated("manual-35")).toBe(true);
      expect(warn).not.toHaveBeenCalled();
    });

    it("re-pairing under an existing name creates no second object", async () => {
      const { service, adapter } = createService([]);
      await service.createUser("known", "Echo");
      for (let i = 0; i < 50; i++) {
        await service.createUser("known", "Echo");
      }
      expect(adapter.writtenObjects.size).toBe(1);
      expect(storedFile().lastClientId).toBe(1);
    });

    it("a creation whose object write failed leaves nothing behind, and the next one works", async () => {
      const { service, adapter } = createService([]);
      adapter.setObjectShouldFail = true;
      for (let i = 0; i < 5; i++) {
        await expect(service.addUser(`ghost-${i}`, "auto-paired")).rejects.toThrow();
      }
      adapter.setObjectShouldFail = false;
      await expect(service.createUser("now-working", "Echo")).resolves.toBe("now-working");
      expect(await service.isUserAuthenticated("ghost-0")).toBe(false);
      expect(await service.isUserAuthenticated("now-working")).toBe(true);
    });
  });

  describe("client-id cache (U2 v1.4.3)", () => {
    it("hits the broker only once across many auth checks", async () => {
      const { service, adapter } = createService(["alexa-1"]);
      let calls = 0;
      const original = adapter.getStatesOfAsync;
      adapter.getStatesOfAsync = async (...args) => {
        calls += 1;
        return original.apply(adapter, args);
      };
      await service.isUserAuthenticated("alexa-1");
      await service.isUserAuthenticated("alexa-1");
      await service.isUserAuthenticated("unknown");
      expect(calls).toBe(1);
    });

    it("addUser updates the cache so the next auth call sees the new client", async () => {
      const { service } = createService([]);
      // Prime cache
      expect(await service.isUserAuthenticated("just-added")).toBe(false);
      await service.addUser("just-added", "browser");
      // Without cache update, this would still return false from the cache.
      expect(await service.isUserAuthenticated("just-added")).toBe(true);
    });

    it("warms the cache when addUser is the very first operation (whitelist not left empty)", async () => {
      const { service } = createService([]);
      // No prior auth check — the cache is still lazy/null at this point
      await service.addUser("first-op-client", "browser");
      // The new client is listed immediately, not only after the next auth check
      expect(service.listPairedClients().map(c => c.key)).toContain("first-op-client");
    });

    it("lists the paired keys once the cache is loaded, none before", async () => {
      const { service } = createService(["alexa-1", "harmony-2"]);
      // Empty before first auth call (cache is lazy)
      expect(service.listPairedClients()).toEqual([]);
      await service.isUserAuthenticated("alexa-1");
      const ids = service.listPairedClients().map(c => c.key);
      expect(ids).toEqual(expect.arrayContaining(["alexa-1", "harmony-2"]));
    });
  });
});

// v1.18.0 (audit 2026-09-15 B1/B2): the first requests after a start arrive in
// parallel — Alexa's discovery fires several at once, and during pairing every
// Echo auto-adds itself with the same burst.
describe("v1.18.0 — parallel requests on a cold cache", () => {
  const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));

  it("reads the client list from the broker once, however many requests arrive together", async () => {
    const { service, adapter } = createService(["alexa-1"]);
    let calls = 0;
    const original = adapter.getStatesOfAsync;
    adapter.getStatesOfAsync = async (...args) => {
      calls += 1;
      await tick();
      return original.apply(adapter, args);
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => service.isUserAuthenticated("alexa-1")));
    expect(results).toEqual([true, true, true, true, true]);
    expect(calls).toBe(1);
  });

  it("keeps a client paired during the cold load when the first broker answer arrives last", async () => {
    // Measured before the fix: key-A's slow read overwrote the cache key-B had
    // just been added to — key-B was refused until the next start although its
    // object was in the database.
    const { service, adapter } = createService([]);
    let slowOnce = true;
    const original = adapter.getStatesOfAsync;
    adapter.getStatesOfAsync = async (...args) => {
      const snapshot = await original.apply(adapter, args);
      if (slowOnce) {
        slowOnce = false;
        for (let i = 0; i < 8; i++) {
          await tick();
        }
      }
      return snapshot;
    };
    adapter.setObjectNotExistsAsync = async (id, obj) => {
      await tick();
      adapter.writtenObjects.set(id, obj);
      return { id };
    };
    await Promise.all([service.addUser("key-A", "auto-paired"), service.addUser("key-B", "auto-paired")]);
    expect(await service.isUserAuthenticated("key-A")).toBe(true);
    expect(await service.isUserAuthenticated("key-B")).toBe(true);
  });

  it("retries the broker on the next request when the shared load failed", async () => {
    const { service, adapter } = createService(["alexa-1"]);
    adapter.getStatesShouldFail = true;
    expect(await service.isUserAuthenticated("alexa-1")).toBe(false);
    adapter.getStatesShouldFail = false;
    expect(await service.isUserAuthenticated("alexa-1")).toBe(true);
  });

  it("books one client once when its first burst adds it in parallel", async () => {
    const { service, adapter } = createService([]);
    adapter.setObjectNotExistsAsync = async (id, obj) => {
      await tick();
      adapter.writtenObjects.set(id, obj);
      return { id };
    };
    let objectWrites = 0;
    const original = adapter.setObjectNotExistsAsync;
    adapter.setObjectNotExistsAsync = async (id, obj) => {
      objectWrites += 1;
      return original(id, obj);
    };
    await Promise.all([
      service.addUser("echo-key", "auto-paired"),
      service.addUser("echo-key", "auto-paired"),
      service.addUser("echo-key", "auto-paired"),
    ]);
    expect(objectWrites).toBe(1);
    expect(storedFile().lastClientId).toBe(1);
  });

  it("lets a second parallel add of the same key share the first one's rejection", async () => {
    const { service, adapter } = createService([]);
    adapter.setObjectShouldFail = true;
    const results = await Promise.allSettled([service.addUser("echo-key", "x"), service.addUser("echo-key", "x")]);
    expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
    // The guard is released afterwards — a later add is a new attempt.
    adapter.setObjectShouldFail = false;
    await expect(service.addUser("echo-key", "x")).resolves.toBeUndefined();
  });
});

describe("v1.15.1 — the client name is a translation object", () => {
  it("writes the device type under every one of the eleven languages", async () => {
    // `common.name` is a translation object for EVERY object type, even where the
    // text comes from the device and has nothing to translate (core team, nut2 #15).
    const { service, adapter } = createService();
    await service.createUser("client-1", "Harmony Hub");
    const name = adapter.writtenObjects.get("clients.1")?.common?.name as Record<string, string>;
    expect(Object.keys(name)).toHaveLength(11);
    expect(name.en).toBe("Harmony Hub");
    expect(name["zh-cn"]).toBe("Harmony Hub");
  });

  it("never writes a bare string as the name", async () => {
    const { service, adapter } = createService();
    await service.createUser("client-2", "Echo");
    expect(typeof adapter.writtenObjects.get("clients.1")?.common?.name).toBe("object");
  });
});

describe("v1.15.1 — every client object carries an explanation", () => {
  it("writes a description on the client datapoint", async () => {
    const { service, adapter } = createService();
    await service.createUser("with-desc", "Echo");
    expect(adapter.writtenObjects.get("clients.1")?.common?.desc).toBeDefined();
  });

  // The folder's description comes from the manifest and the start refresh
  // (main.test.ts, refreshInstanceObjects) — the service writes no folder.
});

// v1.19.0 (audit 2026-09-25 H5): the whitelist names a client by the device type it
// paired with and shows when it paired and when it was last seen — it used to show
// the key twice and "now" as both dates.
describe("UserService.listPairedClients", () => {
  it("keeps the device type and the pairing time of a new client", async () => {
    const { service, adapter } = createService();
    const before = Date.now();
    await service.addUser("key-1", "Echo#Kitchen");
    const [entry] = service.listPairedClients();
    expect(entry).toMatchObject({ key: "key-1", name: "Echo#Kitchen" });
    expect(entry.created).toBeGreaterThanOrEqual(before);
    // Nothing time-dependent and nothing of the key goes into the tree.
    expect((adapter.writtenObjects.get("clients.1") as unknown as { native: object }).native).toEqual({});
  });

  it("keeps the first pairing time when the same client is added again", async () => {
    const { service } = createService();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await service.addUser("key-1", "Echo#Kitchen");
    now.mockReturnValue(1_800_000_000_000);
    await service.addUser("key-1", "Echo#Kitchen");
    now.mockRestore();
    expect(service.listPairedClients()[0].created).toBe(1_700_000_000_000);
  });

  // Audit R-07: the object's own time moves with every object write (a name
  // refresh, a rename in the admin — js-controller sets `ts` on extendObject),
  // so it is no pairing time. The client state's `lc` is: its value is written
  // once at pairing and never changed, and `lc` moves only when the value does.
  it("reads the pairing time from the client state's last change, not the object's time", async () => {
    const adapter = createMockAdapter();
    const service = new UserService({ adapter, logger: createMockLogger(), store: storeWith(["new", "old"]) });
    adapter.stateObjects.push(
      {
        _id: "hueemu.0.clients.1",
        type: "state",
        ts: 1_900_000_000_000, // renewed by a later object write
        common: { name: { en: "harmony#hub", de: "harmony#hub" } },
        native: {},
      } as unknown as ioBroker.StateObject,
      {
        _id: "hueemu.0.clients.2",
        type: "state",
        ts: 1_900_000_000_000,
        common: { name: "Echo" },
        native: {},
      } as unknown as ioBroker.StateObject,
    );
    adapter.stateValues["hueemu.0.clients.1"] = {
      val: "harmony#hub",
      ack: true,
      ts: 1_800_000_000_000,
      lc: 1_700_000_000_000,
      from: "system.adapter.hueemu.0",
      q: 0,
    };
    adapter.stateValues["hueemu.0.clients.2"] = {
      val: "Echo",
      ack: true,
      ts: 1_800_000_000_000,
      lc: 1_600_000_000_000,
      from: "system.adapter.hueemu.0",
      q: 0,
    };
    await service.isUserAuthenticated("nobody");
    const byKey = new Map(service.listPairedClients().map(c => [c.key, c]));
    expect(byKey.get("new")).toMatchObject({ name: "harmony#hub", created: 1_700_000_000_000 });
    expect(byKey.get("old")).toMatchObject({ name: "Echo", created: 1_600_000_000_000 });
  });

  it("falls back to the object's time for a client without a state value", async () => {
    const adapter = createMockAdapter();
    const service = new UserService({ adapter, logger: createMockLogger(), store: storeWith(["bare"]) });
    adapter.stateObjects.push({
      _id: "hueemu.0.clients.1",
      type: "state",
      ts: 1_650_000_000_000,
      common: { name: "Echo" },
      native: {},
    } as unknown as ioBroker.StateObject);
    await service.isUserAuthenticated("nobody");
    expect(service.listPairedClients()[0]).toMatchObject({ key: "bare", created: 1_650_000_000_000 });
  });

  it("still authenticates every stored client when the state values cannot be read", async () => {
    const { service, adapter } = createService(["k"]);
    adapter.getStatesAsync = () => Promise.reject(new Error("states db down"));
    expect(await service.isUserAuthenticated("k")).toBe(true);
  });

  it("moves the last-use time on every successful authentication", async () => {
    const { service } = createService(["k"]);
    await service.isUserAuthenticated("k");
    const first = service.listPairedClients()[0].lastUse;
    await new Promise(resolve => setTimeout(resolve, 5));
    await service.isUserAuthenticated("k");
    expect(service.listPairedClients()[0].lastUse).toBeGreaterThan(first);
  });
});

// v1.19.0 (audit 2026-09-25 H12): a deleted client object revokes that client at once.
describe("UserService.forgetClient", () => {
  it("revokes the real key the file holds for the deleted object's number (decision 22)", async () => {
    const { service } = createService(["other", "living.room"]);
    expect(await service.isUserAuthenticated("living.room")).toBe(true);
    service.forgetClient("2");
    expect(await service.isUserAuthenticated("living.room")).toBe(false);
    expect(await service.isUserAuthenticated("other")).toBe(true);
    expect(service.listPairedClients().map(c => c.key)).toEqual(["other"]);
  });

  // Decision 31: also the next start must not bring the key back.
  it("takes the key out of clients.json", () => {
    const { service } = createService(["a", "b"]);
    service.forgetClient("1");
    expect(storedFile()).toEqual({ lastClientId: 2, clients: { 2: "b" } });
  });

  it("revokes at once even before the first sign-in loaded the client list", async () => {
    const { service } = createService(["a"]);
    service.forgetClient("1");
    expect(await service.isUserAuthenticated("a")).toBe(false);
  });

  it("revokes nothing for an id nobody paired", async () => {
    const { service } = createService(["a"]);
    await service.isUserAuthenticated("a");
    service.forgetClient("2");
    service.forgetClient("a");
    expect(await service.isUserAuthenticated("a")).toBe(true);
  });

  it("revokes in memory and warns when clients.json cannot be written", async () => {
    const adapter = createMockAdapter(["a"]);
    const warn = vi.fn();
    const store = storeWith(["a"]);
    const service = new UserService({ adapter, logger: { ...createMockLogger(), warn }, store });
    expect(await service.isUserAuthenticated("a")).toBe(true);
    rmSync(dataDir, { recursive: true, force: true });
    writeFileSync(dataDir, "");
    service.forgetClient("1");
    expect(await service.isUserAuthenticated("a")).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("the next start forgets its key"));
    rmSync(dataDir, { force: true });
  });
});
