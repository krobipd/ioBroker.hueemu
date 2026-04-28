/**
 * Tests for ApiHandler — orchestration, auth, pairing, malformed inputs
 */

import { expect } from "chai";
import { ApiHandler, type ApiHandlerAdapter } from "./api-handler";
import type { HueRequest, CreateUserRequest } from "../types/hue-api";
import { HueApiError, HueErrorType } from "../types/errors";
import { createMockLogger, createTestIdentity } from "../../test/test-helpers";

interface MockApiAdapter extends ApiHandlerAdapter {
  writtenObjects: Map<string, ioBroker.SettableObject>;
  writtenStates: Map<string, unknown>;
  existingClients: Set<string>;
}

function createMockAdapter(
  existingClients: string[] = [],
  opts: { pairingEnabled?: boolean; disableAuth?: boolean } = {},
): MockApiAdapter {
  const writtenObjects = new Map<string, ioBroker.SettableObject>();
  const writtenStates = new Map<string, unknown>();
  const clients = new Set<string>(existingClients);
  const namespace = "hueemu.0";

  const adapter: MockApiAdapter = {
    namespace,
    log: {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as ioBroker.Logger,
    pairingEnabled: opts.pairingEnabled ?? false,
    disableAuth: opts.disableAuth ?? false,
    writtenObjects,
    writtenStates,
    existingClients: clients,
    setObjectNotExistsAsync: async (id, obj) => {
      writtenObjects.set(id, obj);
      return { id };
    },
    setStateAsync: async (id, state) => {
      const stateObj = writtenStates as Map<string, unknown>;
      stateObj.set(id, (state as { val?: unknown }).val);
      // Track as existing client after creation
      if (id.startsWith("clients.") && id !== "clients") {
        clients.add(id.substring("clients.".length));
      }
      return { id };
    },
    getStatesOfAsync: async () => {
      return Array.from(clients).map(
        (name) =>
          ({
            _id: `${namespace}.clients.${name}`,
            type: "state",
            common: {
              name,
              type: "string",
              role: "text",
              read: true,
              write: false,
            },
            native: {},
          }) as unknown as ioBroker.StateObject,
      );
    },
    getForeignStateAsync: async () => null,
    setForeignStateAsync: async () => {},
    subscribeForeignStates: () => {},
  };

  return adapter;
}

function createHandler(
  existingClients: string[] = [],
  opts: { pairingEnabled?: boolean; disableAuth?: boolean } = {},
) {
  const adapter = createMockAdapter(existingClients, opts);
  const handler = new ApiHandler({
    adapter,
    configServiceConfig: {
      identity: createTestIdentity(),
      discoveryHost: "192.168.1.100",
    },
    devices: [],
    logger: createMockLogger(),
  });
  return { handler, adapter };
}

function makeRequest(body: unknown): HueRequest {
  return {
    method: "POST",
    url: "/api",
    params: {},
    body,
    headers: {},
    ip: "192.168.1.50",
  };
}

describe("ApiHandler", () => {
  describe("createUser — auth/pairing gates", () => {
    it("throws linkButtonNotPressed when pairing disabled and auth enabled", async () => {
      const { handler } = createHandler([], {
        pairingEnabled: false,
        disableAuth: false,
      });
      const req = makeRequest({ devicetype: "test" });
      try {
        await handler.createUser(req, { devicetype: "test" });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).to.be.instanceOf(HueApiError);
        expect((error as HueApiError).type).to.equal(
          HueErrorType.LINK_BUTTON_NOT_PRESSED,
        );
      }
    });

    it("allows pairing when pairingEnabled=true", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const username = await handler.createUser(
        makeRequest({ devicetype: "Amazon Echo" }),
        { devicetype: "Amazon Echo" },
      );
      expect(username).to.be.a("string");
      expect(username.length).to.be.greaterThan(0);
    });

    it("disables pairing after successful creation", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      await handler.createUser(makeRequest({ devicetype: "x" }), {
        devicetype: "x",
      });
      expect(adapter.pairingEnabled).to.equal(false);
    });

    it("allows pairing when disableAuth=true even without link button", async () => {
      const { handler } = createHandler([], { disableAuth: true });
      const username = await handler.createUser(
        makeRequest({ devicetype: "free-pass" }),
        { devicetype: "free-pass" },
      );
      expect(username.length).to.be.greaterThan(0);
    });
  });

  describe("createUser — malformed input guards", () => {
    it("defaults devicetype to 'unknown' when body.devicetype is not a string", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      const body = { devicetype: 42 } as unknown as CreateUserRequest;
      const username = await handler.createUser(makeRequest(body), body);
      expect(username.length).to.be.greaterThan(0);
      // Find the client that was written - its common.name should be "unknown"
      const writtenClientObjects = [...adapter.writtenObjects.entries()].filter(
        ([id]) => id.startsWith("clients.") && id !== "clients",
      );
      expect(writtenClientObjects).to.have.length(1);
      const [, obj] = writtenClientObjects[0];
      expect(obj.common?.name).to.equal("unknown");
    });

    it("defaults devicetype when body.devicetype is empty string", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      await handler.createUser(makeRequest({ devicetype: "" }), {
        devicetype: "",
      });
      const [, obj] = [...adapter.writtenObjects.entries()].find(
        ([id]) => id.startsWith("clients.") && id !== "clients",
      )!;
      expect(obj.common?.name).to.equal("unknown");
    });

    it("ignores non-string body.username and generates UUID", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body = {
        devicetype: "test",
        username: { foo: "bar" },
      } as unknown as CreateUserRequest;
      const username = await handler.createUser(
        makeRequest({ devicetype: "test", username: { foo: "bar" } }),
        body,
      );
      // Must not be "[object Object]" — should be a generated UUID
      expect(username).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("ignores empty body.username and generates UUID", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body = {
        devicetype: "test",
        username: "",
      } as CreateUserRequest;
      const username = await handler.createUser(
        makeRequest({ devicetype: "test", username: "" }),
        body,
      );
      expect(username).to.not.equal("");
      expect(username.length).to.be.greaterThan(10);
    });

    it("accepts valid string body.username", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body: CreateUserRequest = {
        devicetype: "test",
        username: "my-custom-name",
      };
      const username = await handler.createUser(
        makeRequest({ devicetype: "test", username: "my-custom-name" }),
        body,
      );
      expect(username).to.equal("my-custom-name");
    });

    it("handles missing req.body gracefully", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const req: HueRequest = {
        method: "POST",
        url: "/api",
        params: {},
        body: undefined,
        headers: {},
        ip: "1.2.3.4",
      };
      const username = await handler.createUser(req, { devicetype: "x" });
      expect(username.length).to.be.greaterThan(0);
    });
  });

  describe("isUserAuthenticated", () => {
    it("returns true for existing client", async () => {
      const { handler } = createHandler(["alexa"]);
      expect(await handler.isUserAuthenticated("alexa")).to.equal(true);
    });

    it("returns false for unknown client when pairing off", async () => {
      const { handler } = createHandler(["alexa"], { pairingEnabled: false });
      expect(await handler.isUserAuthenticated("stranger")).to.equal(false);
    });

    it("auto-adds unknown clients during pairing window", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      const result = await handler.isUserAuthenticated("new-echo-id");
      expect(result).to.equal(true);
      expect(adapter.existingClients.has("new-echo-id")).to.equal(true);
    });

    it("returns false for empty username", async () => {
      const { handler } = createHandler(["foo"]);
      expect(await handler.isUserAuthenticated("")).to.equal(false);
    });
  });

  describe("isPairingEnabled / isAuthDisabled", () => {
    it("reflects adapter.pairingEnabled", () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      expect(handler.isPairingEnabled()).to.equal(true);
      adapter.pairingEnabled = false;
      expect(handler.isPairingEnabled()).to.equal(false);
    });

    it("reflects adapter.disableAuth", () => {
      const { handler } = createHandler([], { disableAuth: true });
      expect(handler.isAuthDisabled()).to.equal(true);
    });
  });

  describe("fallback", () => {
    it("returns empty object for unknown routes", async () => {
      const { handler } = createHandler();
      const result = await handler.fallback({
        method: "GET",
        url: "/api/foo/bar",
        params: {},
        body: undefined,
        headers: {},
        ip: "1.2.3.4",
      });
      expect(result).to.deep.equal({});
    });
  });

  describe("getConfig", () => {
    it("returns public bridge config without requiring auth", async () => {
      const { handler } = createHandler();
      const req = makeRequest(undefined);
      const config = await handler.getConfig(req, "anyone");
      expect(config).to.have.property("bridgeid");
      expect(config).to.have.property("mac");
      expect(config).to.have.property("modelid");
    });
  });
});
