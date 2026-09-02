/**
 * Tests for UserService — pairing, authentication, client storage
 */

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import type { Mock } from "vitest";
import {
  CLIENT_CREATE_CEILING_PER_HOUR,
  MAX_DEVICETYPE_LENGTH,
  UserService,
  type UserServiceAdapter,
} from "./user-service";
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
    setObjectNotExistsAsync: (id, obj) => {
      if (adapter.setObjectShouldFail) {
        return Promise.reject(new Error("setObjectNotExistsAsync failure"));
      }
      writtenObjects.set(id, obj);
      return Promise.resolve({ id });
    },
    setStateAsync: (id, state) => {
      if (adapter.setStateShouldFail) {
        return Promise.reject(new Error("setStateAsync failure"));
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
  };

  return adapter;
}

function createService(existingClients: string[] = []): { service: UserService; adapter: MockUserAdapter } {
  const adapter = createMockAdapter(existingClients);
  const service = new UserService({ adapter, logger: createMockLogger() });
  return { service, adapter };
}

describe("UserService", () => {
  describe("addUser", () => {
    it("stores at most 100 chars of the devicetype as the object name", async () => {
      const { service, adapter } = createService();
      await service.addUser("long-name-client", "x".repeat(300));
      expect(adapter.writtenObjects.get("clients.long-name-client")?.common?.name).toHaveLength(MAX_DEVICETYPE_LENGTH);
    });

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

  describe("hourly ceiling on persistent client creations (any path)", () => {
    type LogFn = (message: string) => void;
    function serviceWithWarnSpy(): { service: UserService; adapter: MockUserAdapter; warn: Mock<LogFn> } {
      const adapter = createMockAdapter();
      const warn = vi.fn<LogFn>();
      const service = new UserService({
        adapter,
        logger: { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn, error: vi.fn<LogFn>() },
      });
      return { service, adapter, warn };
    }

    async function fillTheHour(service: UserService, prefix: string): Promise<void> {
      for (let i = 0; i < CLIENT_CREATE_CEILING_PER_HOUR; i++) {
        await service.createUser(`${prefix}-${i}`, "flood");
      }
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T10:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects the 101st creation within one hour and warns exactly once", async () => {
      const { service, adapter, warn } = serviceWithWarnSpy();
      await fillTheHour(service, "c");
      await expect(service.createUser("c-100", "flood")).rejects.toThrow(/ceiling/i);
      await expect(service.createUser("c-101", "flood")).rejects.toThrow(/ceiling/i);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Client creation ceiling reached"));
      expect(adapter.writtenObjects.has("clients.c-100")).toBe(false);
    });

    it("auto-adds count against the same ceiling", async () => {
      const { service } = serviceWithWarnSpy();
      await fillTheHour(service, "c");
      service.resetAutoAddBudget();
      await expect(service.addUser("auto-1", "echo", true)).rejects.toThrow(/ceiling/i);
    });

    it("opens a fresh window after the hour — a whole chain passes again and the warning re-arms", async () => {
      const { service, warn } = serviceWithWarnSpy();
      await fillTheHour(service, "c");
      await expect(service.createUser("over", "flood")).rejects.toThrow(/ceiling/i);
      vi.setSystemTime(new Date("2026-09-02T11:00:01Z"));
      // Not just one — the counter must be zeroed, or the second creation trips again.
      await fillTheHour(service, "later");
      await expect(service.createUser("later-over", "ok")).rejects.toThrow(/ceiling/i);
      expect(warn).toHaveBeenCalledTimes(2);
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
