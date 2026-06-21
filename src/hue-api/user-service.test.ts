/**
 * Tests for UserService — pairing, authentication, client storage
 */

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { UserService, type UserServiceAdapter } from "./user-service";
import { createMockLogger } from "../../test/test-helpers";

interface MockUserAdapter extends UserServiceAdapter {
  writtenObjects: Map<string, ioBroker.SettableObject>;
  writtenStates: Map<string, ioBroker.SettableState>;
  stateObjects: ioBroker.StateObject[];
  setObjectShouldFail: boolean;
  setStateShouldFail: boolean;
  getStatesShouldFail: boolean;
}

function createMockAdapter(existingClients: string[] = []): MockUserAdapter {
  const writtenObjects = new Map<string, ioBroker.SettableObject>();
  const writtenStates = new Map<string, ioBroker.SettableState>();
  const namespace = "hueemu.0";

  const stateObjects: ioBroker.StateObject[] = existingClients.map(
    name =>
      ({
        _id: `${namespace}.clients.${name}`,
        type: "state",
        common: { name, type: "string", role: "text", read: true, write: false },
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
    setObjectNotExistsAsync: async (id, obj) => {
      if (adapter.setObjectShouldFail) {
        throw new Error("setObjectNotExistsAsync failure");
      }
      writtenObjects.set(id, obj);
      return { id };
    },
    setStateAsync: async (id, state) => {
      if (adapter.setStateShouldFail) {
        throw new Error("setStateAsync failure");
      }
      writtenStates.set(id, state);
      return { id };
    },
    getStatesOfAsync: async () => {
      if (adapter.getStatesShouldFail) {
        throw new Error("getStatesOfAsync failure");
      }
      return stateObjects;
    },
  };

  return adapter;
}

function createService(existingClients: string[] = []) {
  const adapter = createMockAdapter(existingClients);
  const service = new UserService({ adapter, logger: createMockLogger() });
  return { service, adapter };
}

describe("UserService", () => {
  describe("addUser", () => {
    it("creates client state object with sanitized id", async () => {
      const { service, adapter } = createService();
      await service.addUser("alexa-echo-1", "Amazon Echo");
      expect(adapter.writtenObjects.has("clients.alexa-echo-1")).toBe(true);
      const obj = adapter.writtenObjects.get("clients.alexa-echo-1");
      expect(obj?.common?.name).toBe("Amazon Echo");
    });

    it("sanitizes FORBIDDEN_CHARS in username", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      expect(adapter.writtenObjects.has("clients.user_with_dots")).toBe(true);
    });

    it("sanitizes whitespace and special chars", async () => {
      const { service, adapter } = createService();
      await service.addUser("hello world!", "test");
      expect(adapter.writtenObjects.has("clients.hello_world_")).toBe(true);
    });

    it("defaults devicetype to 'unknown'", async () => {
      const { service, adapter } = createService();
      await service.addUser("abc123");
      const obj = adapter.writtenObjects.get("clients.abc123");
      expect(obj?.common?.name).toBe("unknown");
    });

    it("stores original username as state value (not sanitized)", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      const state = adapter.writtenStates.get("clients.user_with_dots");
      expect((state as { val: unknown } | undefined)?.val).toBe("user.with.dots");
    });

    it("creates clients parent folder", async () => {
      const { service, adapter } = createService();
      await service.addUser("foo", "bar");
      const folder = adapter.writtenObjects.get("clients");
      expect(folder).toBeDefined();
      expect(folder?.type).toBe("meta");
    });

    it("does not throw if setObjectNotExistsAsync fails", async () => {
      const { service, adapter } = createService();
      adapter.setObjectShouldFail = true;
      // Must not propagate the error — the service logs and continues
      await service.addUser("foo", "bar");
    });

    it("does not throw if setStateAsync fails", async () => {
      const { service, adapter } = createService();
      adapter.setStateShouldFail = true;
      await service.addUser("foo", "bar");
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
      const sanitized = "user1";
      const obj = adapter.writtenObjects.get(`clients.${sanitized}`);
      expect(obj?.common?.name).toBe("unknown");
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

    it("matches using sanitized username", async () => {
      // Stored as sanitized "user_with_dots", lookup with raw dotted form
      const { service } = createService(["user_with_dots"]);
      expect(await service.isUserAuthenticated("user.with.dots")).toBe(true);
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

  describe("auto-add cap (U1+R2 v1.4.3)", () => {
    it("rejects auto-add once 64 clients are added in the same window", async () => {
      const { service } = createService([]);
      service.resetAutoAddBudget();
      // 64 successful auto-adds
      for (let i = 0; i < 64; i++) {
        await service.addUser(`auto-${i}`, "echo", true);
      }
      // 65th throws — the per-window cap is exhausted
      try {
        await service.addUser("auto-65", "echo", true);
        throw new Error("Should have thrown after cap");
      } catch (err) {
        expect((err as Error).message).toMatch(/cap reached/i);
      }
    });

    it("manual createUser is NOT counted against the auto-add cap", async () => {
      const { service } = createService([]);
      service.resetAutoAddBudget();
      // Fill the auto-add cap
      for (let i = 0; i < 64; i++) {
        await service.addUser(`auto-${i}`, "echo", true);
      }
      // Manual createUser still works (gated by the link button, not the cap)
      const manual = await service.createUser("explicit-user", "browser");
      expect(manual).toBe("explicit-user");
    });

    it("resetAutoAddBudget clears the counter (per pairing window)", async () => {
      const { service } = createService([]);
      service.resetAutoAddBudget();
      for (let i = 0; i < 64; i++) {
        await service.addUser(`auto-${i}`, "echo", true);
      }
      // Cap exhausted: a further auto-add throws...
      await expect(service.addUser("over-cap", "echo", true)).rejects.toThrow(/cap reached/i);
      // ...until the window resets, after which auto-add works again.
      service.resetAutoAddBudget();
      await service.addUser("fresh-1", "echo", true);
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
      // Add WITHOUT viaAutoAdd flag (manual path)
      await service.addUser("just-added", "browser");
      // Without cache update, this would still return false from the cache.
      expect(await service.isUserAuthenticated("just-added")).toBe(true);
    });

    it("warms the cache when addUser is the very first operation (whitelist not left empty)", async () => {
      const { service } = createService([]);
      // No prior auth check — the cache is still lazy/null at this point
      await service.addUser("first-op-client", "browser");
      // The new client is listed immediately, not only after the next auth check
      expect(service.listCachedClientIds()).toContain("first-op-client");
    });

    it("listCachedClientIds returns sanitized ids currently in the cache", async () => {
      const { service } = createService(["alexa-1", "harmony-2"]);
      // Empty before first auth call (cache is lazy)
      expect(service.listCachedClientIds()).toEqual([]);
      await service.isUserAuthenticated("alexa-1");
      const ids = service.listCachedClientIds();
      expect(ids).toEqual(expect.arrayContaining(["alexa-1", "harmony-2"]));
    });
  });
});
