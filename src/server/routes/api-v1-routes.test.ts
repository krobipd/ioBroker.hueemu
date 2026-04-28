/**
 * Tests for api-v1-routes Fastify plugin — malformed requests, auth flows
 */

import { expect } from "chai";
import Fastify, { type FastifyInstance } from "fastify";
import { apiV1Routes } from "./api-v1-routes";
import { hueErrorHandler } from "../middleware/error-handler";
import type {
  HueApiHandler,
  HueRequest,
  CreateUserRequest,
  FullState,
  BridgeConfigPublic,
} from "../../types/hue-api";
import type {
  Light,
  LightsCollection,
  LightStateUpdate,
  LightStateResult,
} from "../../types/light";

interface MockHandlerCalls {
  createUser: Array<{ req: HueRequest; body: CreateUserRequest }>;
  setLightState: Array<{ lightId: string; state: LightStateUpdate }>;
  setGroupAction: Array<{ groupId: string; state: LightStateUpdate }>;
  getAllLights: number;
  getLightById: string[];
  fallback: HueRequest[];
}

function createMockHandler(
  opts: {
    isAuthenticated?: boolean;
    authDisabled?: boolean;
    username?: string;
  } = {},
): HueApiHandler & { calls: MockHandlerCalls } {
  const calls: MockHandlerCalls = {
    createUser: [],
    setLightState: [],
    setGroupAction: [],
    getAllLights: 0,
    getLightById: [],
    fallback: [],
  };

  const handler: HueApiHandler & { calls: MockHandlerCalls } = {
    calls,
    createUser: async (req, body) => {
      calls.createUser.push({ req, body });
      return opts.username ?? "generated-user-123";
    },
    getFullState: async () =>
      ({ lights: {}, groups: {}, config: {} }) as unknown as FullState,
    getConfig: async () =>
      ({
        name: "Philips hue",
        bridgeid: "TESTBRIDGE",
        mac: "aa:bb:cc:dd:ee:ff",
      }) as BridgeConfigPublic,
    getAllLights: async () => {
      calls.getAllLights++;
      return {} as LightsCollection;
    },
    getLightById: async (_req, _username, lightId) => {
      calls.getLightById.push(lightId);
      return { state: { on: true } } as unknown as Light;
    },
    setLightState: async (_req, _username, lightId, state) => {
      calls.setLightState.push({ lightId, state });
      return [{ success: { [`/lights/${lightId}/state/on`]: true } }];
    },
    setGroupAction: async (_req, _username, groupId, state) => {
      calls.setGroupAction.push({ groupId, state });
      return [] as LightStateResult[];
    },
    fallback: async (req) => {
      calls.fallback.push(req);
      return {};
    },
    isUserAuthenticated: async () => opts.isAuthenticated ?? true,
    isPairingEnabled: () => false,
    isAuthDisabled: () => opts.authDisabled ?? false,
  };

  return handler;
}

async function buildApp(handler: HueApiHandler): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setErrorHandler(hueErrorHandler);
  await app.register(apiV1Routes, { handler });
  return app;
}

describe("apiV1Routes — POST /api", () => {
  it("creates user with valid body", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: { devicetype: "Amazon Echo" },
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0]).to.have.property("success");
    expect(parsed[0].success.username).to.equal("generated-user-123");
    expect(handler.calls.createUser).to.have.length(1);
  });

  it("rejects body with missing devicetype", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: {},
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(5); // MISSING_PARAMETERS
    expect(handler.calls.createUser).to.have.length(0);
  });

  it("rejects body.devicetype as object", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: { devicetype: { evil: "nested" } },
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(5);
    expect(handler.calls.createUser).to.have.length(0);
  });

  it("rejects body.devicetype as number", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: { devicetype: 42 },
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(5);
  });

  it("rejects body.devicetype as empty string", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: { devicetype: "" },
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(5);
  });

  it("rejects top-level array body", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      payload: ["devicetype"],
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(5);
  });

  it("rejects missing body entirely (fastify ignores empty POST)", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "POST",
      url: "/api",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0]).to.have.property("error");
    expect(handler.calls.createUser).to.have.length(0);
  });
});

describe("apiV1Routes — GET auth-required routes", () => {
  it("returns unauthorized for getAllLights without auth", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/unknown-user/lights",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(1); // UNAUTHORIZED_USER
  });

  it("allows getAllLights with valid auth", async () => {
    const handler = createMockHandler({ isAuthenticated: true });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/valid-user/lights",
    });
    expect(handler.calls.getAllLights).to.equal(1);
    // empty collection serializes to {}
    expect(JSON.parse(res.body)).to.deep.equal({});
  });

  it("config endpoint does not require auth", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/any-name/config",
    });
    expect(res.statusCode).to.equal(200);
    expect(JSON.parse(res.body)).to.have.property("bridgeid");
  });
});

describe("apiV1Routes — PUT /lights/:id/state", () => {
  it("accepts valid state update", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/lights/1/state",
      payload: { on: true, bri: 200 },
    });
    expect(res.statusCode).to.equal(200);
    expect(handler.calls.setLightState).to.have.length(1);
    expect(handler.calls.setLightState[0].lightId).to.equal("1");
  });

  it("rejects array payload for state update", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/lights/1/state",
      payload: [{ on: true }],
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(2); // INVALID_JSON
    expect(handler.calls.setLightState).to.have.length(0);
  });

  it("rejects missing body for state update", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/lights/1/state",
      headers: { "content-type": "application/json" },
      payload: "",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0]).to.have.property("error");
    expect(handler.calls.setLightState).to.have.length(0);
  });

  it("rejects null body for state update", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/lights/1/state",
      payload: null as unknown as object,
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(2);
  });
});

describe("apiV1Routes — PUT /groups/:id/action (Harmony)", () => {
  it("accepts valid group action", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/groups/0/action",
      payload: { on: true },
    });
    expect(res.statusCode).to.equal(200);
    expect(handler.calls.setGroupAction).to.have.length(1);
  });

  it("rejects array payload for group action", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "PUT",
      url: "/api/user1/groups/0/action",
      payload: [{ on: true }],
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(2);
    expect(handler.calls.setGroupAction).to.have.length(0);
  });
});

describe("apiV1Routes — fallback & empty collections", () => {
  it("falls through to handler.fallback for unknown API path", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/user1/something-unknown",
    });
    expect(handler.calls.fallback).to.have.length(1);
    expect(res.statusCode).to.equal(200);
  });

  it("returns empty object for unimplemented collections (groups)", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/user1/groups",
    });
    expect(JSON.parse(res.body)).to.deep.equal({});
  });

  it("returns empty object for sensors", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/user1/sensors",
    });
    expect(JSON.parse(res.body)).to.deep.equal({});
  });

  it("unauthorized user still blocked on empty collections", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/stranger/groups",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).to.equal(1); // UNAUTHORIZED_USER
  });
});
