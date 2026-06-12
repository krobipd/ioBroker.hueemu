/**
 * Tests for ApiHandler — orchestration, auth, pairing, malformed inputs
 */

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

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
        name =>
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

function createHandler(existingClients: string[] = [], opts: { pairingEnabled?: boolean; disableAuth?: boolean } = {}) {
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
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
        expect((error as HueApiError).type).toBe(HueErrorType.LINK_BUTTON_NOT_PRESSED);
      }
    });

    it("allows pairing when pairingEnabled=true", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const username = await handler.createUser(makeRequest({ devicetype: "Amazon Echo" }), {
        devicetype: "Amazon Echo",
      });
      expect(typeof username).toBe("string");
      expect(username.length).toBeGreaterThan(0);
    });

    it("disables pairing after successful creation", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      await handler.createUser(makeRequest({ devicetype: "x" }), {
        devicetype: "x",
      });
      expect(adapter.pairingEnabled).toBe(false);
    });

    it("allows pairing when disableAuth=true even without link button", async () => {
      const { handler } = createHandler([], { disableAuth: true });
      const username = await handler.createUser(makeRequest({ devicetype: "free-pass" }), { devicetype: "free-pass" });
      expect(username.length).toBeGreaterThan(0);
    });
  });

  describe("createUser — malformed input guards", () => {
    it("defaults devicetype to 'unknown' when body.devicetype is not a string", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      const body = { devicetype: 42 } as unknown as CreateUserRequest;
      const username = await handler.createUser(makeRequest(body), body);
      expect(username.length).toBeGreaterThan(0);
      // Find the client that was written - its common.name should be "unknown"
      const writtenClientObjects = [...adapter.writtenObjects.entries()].filter(
        ([id]) => id.startsWith("clients.") && id !== "clients",
      );
      expect(writtenClientObjects).toHaveLength(1);
      const [, obj] = writtenClientObjects[0];
      expect(obj.common?.name).toBe("unknown");
    });

    it("defaults devicetype when body.devicetype is empty string", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      await handler.createUser(makeRequest({ devicetype: "" }), {
        devicetype: "",
      });
      const [, obj] = [...adapter.writtenObjects.entries()].find(
        ([id]) => id.startsWith("clients.") && id !== "clients",
      )!;
      expect(obj.common?.name).toBe("unknown");
    });

    it("ignores non-string body.username and generates UUID", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body = {
        devicetype: "test",
        username: { foo: "bar" },
      } as unknown as CreateUserRequest;
      const username = await handler.createUser(makeRequest({ devicetype: "test", username: { foo: "bar" } }), body);
      // Must not be "[object Object]" — should be a generated UUID
      expect(username).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("ignores empty body.username and generates UUID", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body = {
        devicetype: "test",
        username: "",
      } as CreateUserRequest;
      const username = await handler.createUser(makeRequest({ devicetype: "test", username: "" }), body);
      expect(username).not.toBe("");
      expect(username.length).toBeGreaterThan(10);
    });

    it("accepts valid string body.username", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      const body: CreateUserRequest = {
        devicetype: "test",
        username: "my-custom-name",
      };
      const username = await handler.createUser(makeRequest({ devicetype: "test", username: "my-custom-name" }), body);
      expect(username).toBe("my-custom-name");
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
      expect(username.length).toBeGreaterThan(0);
    });
  });

  describe("isUserAuthenticated", () => {
    it("returns true for existing client", async () => {
      const { handler } = createHandler(["alexa"]);
      expect(await handler.isUserAuthenticated("alexa")).toBe(true);
    });

    it("returns false for unknown client when pairing off", async () => {
      const { handler } = createHandler(["alexa"], { pairingEnabled: false });
      expect(await handler.isUserAuthenticated("stranger")).toBe(false);
    });

    it("auto-adds unknown clients during pairing window", async () => {
      const { handler, adapter } = createHandler([], { pairingEnabled: true });
      const result = await handler.isUserAuthenticated("new-echo-id");
      expect(result).toBe(true);
      expect(adapter.existingClients.has("new-echo-id")).toBe(true);
    });

    it("returns false for empty username", async () => {
      const { handler } = createHandler(["foo"]);
      expect(await handler.isUserAuthenticated("")).toBe(false);
    });
  });

  describe("isAuthDisabled", () => {
    it("reflects adapter.disableAuth", () => {
      const { handler } = createHandler([], { disableAuth: true });
      expect(handler.isAuthDisabled()).toBe(true);
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
      expect(result).toEqual({});
    });
  });

  describe("getConfig", () => {
    it("returns public bridge config without requiring auth", async () => {
      const { handler } = createHandler();
      const req = makeRequest(undefined);
      const config = await handler.getConfig(req, "anyone");
      expect(config).toHaveProperty("bridgeid");
      expect(config).toHaveProperty("mac");
      expect(config).toHaveProperty("modelid");
    });
  });

  // v1.8.1 — orchestration/delegation methods (previously only the
  // auth/pairing gates were covered).
  describe("light orchestration (v1.8.1)", () => {
    function createHandlerWithDevices(
      stateValues: Record<string, unknown>,
      opts: { pairingEnabled?: boolean } = {},
    ): { handler: ApiHandler; adapter: MockApiAdapter; foreignWrites: Map<string, unknown> } {
      const adapter = createMockAdapter([], opts);
      const foreignWrites = new Map<string, unknown>();
      adapter.getForeignStateAsync = async (id: string) =>
        id in stateValues ? ({ val: stateValues[id], ack: true } as ioBroker.State) : null;
      adapter.setForeignStateAsync = async (id: string, state: ioBroker.SettableState) => {
        foreignWrites.set(id, (state as { val?: unknown }).val);
      };
      const handler = new ApiHandler({
        adapter,
        configServiceConfig: { identity: createTestIdentity(), discoveryHost: "192.168.1.100" },
        devices: [
          { name: "Kitchen", lightType: "dimmable", onState: "test.on", briState: "test.bri" },
          { name: "Lounge", lightType: "onoff", onState: "test2.on" },
        ],
        logger: createMockLogger(),
      });
      return { handler, adapter, foreignWrites };
    }

    const req = makeRequest(undefined);

    it("getAllLights returns the configured lights with 1-based ids", async () => {
      const { handler } = createHandlerWithDevices({ "test.on": true, "test.bri": 50 });
      const lights = await handler.getAllLights(req, "user");
      expect(Object.keys(lights)).toEqual(["1", "2"]);
      expect(lights["1"].name).toBe("Kitchen");
    });

    it("getLightById delegates and returns the converted state", async () => {
      const { handler } = createHandlerWithDevices({ "test.on": true, "test.bri": 50 });
      const light = await handler.getLightById(req, "user", "1");
      expect(light.state.on).toBe(true);
      expect(light.state.bri).toBe(127);
    });

    it("setLightState writes the converted value to the foreign state", async () => {
      const { handler, foreignWrites } = createHandlerWithDevices({});
      const results = await handler.setLightState(req, "user", "1", { on: true, bri: 254 });
      expect(foreignWrites.get("test.on")).toBe(true);
      expect(foreignWrites.get("test.bri")).toBe(254);
      expect(results).toHaveLength(2);
    });

    it("getFullState mirrors pairingEnabled into config.linkbutton", async () => {
      const { handler, adapter } = createHandlerWithDevices({ "test.on": false });
      adapter.pairingEnabled = true;
      const state = await handler.getFullState(req, "user");
      expect(state.config.linkbutton).toBe(true);
      expect(Object.keys(state.lights)).toEqual(["1", "2"]);
      adapter.pairingEnabled = false;
      const state2 = await handler.getFullState(req, "user");
      expect(state2.config.linkbutton).toBe(false);
    });

    it("setGroupAction applies the state to every light and returns group-addressed successes", async () => {
      const { handler, foreignWrites } = createHandlerWithDevices({});
      const results = await handler.setGroupAction(req, "user", "0", { on: false });
      expect(foreignWrites.get("test.on")).toBe(false);
      expect(foreignWrites.get("test2.on")).toBe(false);
      expect(results).toEqual([{ success: { "/groups/0/action/on": false } }]);
    });

    it("setGroupAction tolerates a failing light (warn, others still set)", async () => {
      const { handler, adapter, foreignWrites } = createHandlerWithDevices({});
      const origSet = adapter.setForeignStateAsync;
      adapter.setForeignStateAsync = async (id: string, state: ioBroker.SettableState) => {
        if (id === "test.on") {
          throw new Error("broker hiccup");
        }
        return origSet(id, state);
      };
      const results = await handler.setGroupAction(req, "user", "0", { on: true });
      expect(foreignWrites.get("test2.on")).toBe(true); // second light unaffected
      expect(results).toHaveLength(1); // group response shape regardless
    });

    it("onStateChange updates the binding cache so the next read sees the new value", async () => {
      const { handler } = createHandlerWithDevices({ "test.on": false });
      await handler.initialize();
      expect((await handler.getLightById(req, "user", "1")).state.on).toBe(false);
      handler.onStateChange("test.on", true);
      expect((await handler.getLightById(req, "user", "1")).state.on).toBe(true);
    });

    it("initialize subscribes to all mapped foreign states", async () => {
      const { handler, adapter } = createHandlerWithDevices({});
      const patterns: string[] = [];
      adapter.subscribeForeignStates = (pattern: string) => {
        patterns.push(pattern);
      };
      await handler.initialize();
      expect(patterns).toEqual(expect.arrayContaining(["test.on", "test.bri", "test2.on"]));
    });

    it("resetAutoAddBudget re-opens the auto-add window", async () => {
      const { handler } = createHandler([], { pairingEnabled: true });
      // Exhaust the cap via auto-adds
      for (let i = 0; i < 64; i++) {
        expect(await handler.isUserAuthenticated(`echo-${i}`)).toBe(true);
      }
      expect(await handler.isUserAuthenticated("over-cap")).toBe(false);
      handler.resetAutoAddBudget();
      expect(await handler.isUserAuthenticated("fresh-client")).toBe(true);
    });
  });
});
