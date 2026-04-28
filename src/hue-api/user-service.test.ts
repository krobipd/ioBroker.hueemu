/**
 * Tests for UserService — pairing, authentication, client storage
 */

import { expect } from "chai";
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

function createMockAdapter(
  existingClients: string[] = [],
): MockUserAdapter {
  const writtenObjects = new Map<string, ioBroker.SettableObject>();
  const writtenStates = new Map<string, ioBroker.SettableState>();
  const namespace = "hueemu.0";

  const stateObjects: ioBroker.StateObject[] = existingClients.map(
    (name) =>
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
      expect(adapter.writtenObjects.has("clients.alexa-echo-1")).to.equal(true);
      const obj = adapter.writtenObjects.get("clients.alexa-echo-1");
      expect(obj?.common?.name).to.equal("Amazon Echo");
    });

    it("sanitizes FORBIDDEN_CHARS in username", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      expect(adapter.writtenObjects.has("clients.user_with_dots")).to.equal(
        true,
      );
    });

    it("sanitizes whitespace and special chars", async () => {
      const { service, adapter } = createService();
      await service.addUser("hello world!", "test");
      expect(adapter.writtenObjects.has("clients.hello_world_")).to.equal(true);
    });

    it("defaults devicetype to 'unknown'", async () => {
      const { service, adapter } = createService();
      await service.addUser("abc123");
      const obj = adapter.writtenObjects.get("clients.abc123");
      expect(obj?.common?.name).to.equal("unknown");
    });

    it("stores original username as state value (not sanitized)", async () => {
      const { service, adapter } = createService();
      await service.addUser("user.with.dots", "test");
      const state = adapter.writtenStates.get("clients.user_with_dots");
      expect((state as { val: unknown } | undefined)?.val).to.equal(
        "user.with.dots",
      );
    });

    it("creates clients parent folder", async () => {
      const { service, adapter } = createService();
      await service.addUser("foo", "bar");
      const folder = adapter.writtenObjects.get("clients");
      expect(folder).to.exist;
      expect(folder?.type).to.equal("meta");
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
      expect(result).to.equal("my-username");
    });

    it("generates a UUID when no username is provided", async () => {
      const { service } = createService();
      const result = await service.createUser(undefined, "test");
      expect(result).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("generates a UUID when username is empty string", async () => {
      const { service } = createService();
      const result = await service.createUser("", "test");
      expect(result.length).to.be.greaterThan(0);
      expect(result).to.not.equal("");
    });

    it("defaults devicetype to 'unknown'", async () => {
      const { service, adapter } = createService();
      await service.createUser("user1");
      const sanitized = "user1";
      const obj = adapter.writtenObjects.get(`clients.${sanitized}`);
      expect(obj?.common?.name).to.equal("unknown");
    });
  });

  describe("isUserAuthenticated", () => {
    it("returns false when no clients exist", async () => {
      const { service } = createService([]);
      expect(await service.isUserAuthenticated("anyone")).to.equal(false);
    });

    it("returns true for a paired client", async () => {
      const { service } = createService(["alexa-123"]);
      expect(await service.isUserAuthenticated("alexa-123")).to.equal(true);
    });

    it("returns false for unknown username", async () => {
      const { service } = createService(["alexa-123"]);
      expect(await service.isUserAuthenticated("unknown-user")).to.equal(false);
    });

    it("matches using sanitized username", async () => {
      // Stored as sanitized "user_with_dots", lookup with raw dotted form
      const { service } = createService(["user_with_dots"]);
      expect(await service.isUserAuthenticated("user.with.dots")).to.equal(
        true,
      );
    });

    it("returns false when getStatesOfAsync throws", async () => {
      const { service, adapter } = createService(["foo"]);
      adapter.getStatesShouldFail = true;
      expect(await service.isUserAuthenticated("foo")).to.equal(false);
    });

    it("returns false for empty username string", async () => {
      const { service } = createService(["foo"]);
      expect(await service.isUserAuthenticated("")).to.equal(false);
    });
  });
});
