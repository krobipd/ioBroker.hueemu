/**
 * Tests for api-v1-routes Fastify plugin — malformed requests, auth flows
 */

import Fastify, { type FastifyInstance } from "fastify";
import { apiV1Routes } from "./api-v1-routes";
import { hueErrorHandler } from "../middleware/error-handler";
import type {
  HueApiHandler,
  HueRequest,
  CreateUserRequest,
  FullState,
  BridgeConfigPublic,
  BridgeConfigFull,
} from "../../types/hue-api";
import type { Light, LightStateUpdate, LightStateResult } from "../../types/light";

interface MockHandlerCalls {
  createUser: Array<{ req: HueRequest; body: CreateUserRequest }>;
  setLightState: Array<{ lightId: string; state: LightStateUpdate }>;
  setGroupAction: Array<{ groupId: string; state: LightStateUpdate }>;
  getAllLights: number;
  getLightById: string[];
  fallback: HueRequest[];
  isUserAuthenticated: number;
  isKnownUser: number;
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
    isUserAuthenticated: 0,
    isKnownUser: 0,
  };

  const handler: HueApiHandler & { calls: MockHandlerCalls } = {
    calls,
    createUser: (req, body) => {
      calls.createUser.push({ req, body });
      return Promise.resolve(opts.username ?? "generated-user-123");
    },
    getFullState: () => Promise.resolve({ lights: {}, groups: {}, config: {} } as unknown as FullState),
    getConfig: () =>
      ({
        name: "Philips hue",
        bridgeid: "TESTBRIDGE",
        mac: "aa:bb:cc:dd:ee:ff",
      }) as BridgeConfigPublic,
    getFullConfig: () =>
      ({
        name: "Philips hue",
        bridgeid: "TESTBRIDGE",
        mac: "aa:bb:cc:dd:ee:ff",
        ipaddress: "192.168.1.100",
        whitelist: {},
      }) as unknown as BridgeConfigFull,
    getAllLights: () => {
      calls.getAllLights++;
      return Promise.resolve({});
    },
    getLightById: (_req, _username, lightId) => {
      calls.getLightById.push(lightId);
      return Promise.resolve({ state: { on: true } } as unknown as Light);
    },
    setLightState: (_req, _username, lightId, state) => {
      calls.setLightState.push({ lightId, state });
      return Promise.resolve([{ success: { [`/lights/${lightId}/state/on`]: true } }]);
    },
    setGroupAction: (_req, _username, groupId, state) => {
      calls.setGroupAction.push({ groupId, state });
      return Promise.resolve([] as LightStateResult[]);
    },
    fallback: req => {
      calls.fallback.push(req);
      return {};
    },
    isUserAuthenticated: () => {
      calls.isUserAuthenticated++;
      return Promise.resolve(opts.isAuthenticated ?? true);
    },
    isKnownUser: () => {
      calls.isKnownUser++;
      return Promise.resolve(opts.isAuthenticated ?? true);
    },
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
    expect(parsed[0]).toHaveProperty("success");
    expect(parsed[0].success.username).toBe("generated-user-123");
    expect(handler.calls.createUser).toHaveLength(1);
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
    expect(parsed[0].error.type).toBe(5); // MISSING_PARAMETERS
    expect(handler.calls.createUser).toHaveLength(0);
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
    expect(parsed[0].error.type).toBe(5);
    expect(handler.calls.createUser).toHaveLength(0);
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
    expect(parsed[0].error.type).toBe(5);
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
    expect(parsed[0].error.type).toBe(5);
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
    expect(parsed[0].error.type).toBe(5);
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
    expect(parsed[0]).toHaveProperty("error");
    expect(handler.calls.createUser).toHaveLength(0);
  });
});

describe("apiV1Routes — GET auth-required routes", () => {
  it("GET /api/config (no username) returns the public config — the discovery probe real bridges answer", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/config" });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveProperty("bridgeid");
    expect(parsed).not.toHaveProperty("ipaddress");
    // Never routed through the auth/auto-add path as a username called "config".
    expect(handler.calls.isUserAuthenticated).toBe(0);
    expect(handler.calls.isKnownUser).toBe(0);
  });

  it("/api/:username/config uses the pure lookup — never the auto-adding auth path", async () => {
    // A discovery app polls /api/nouser/config while waiting for the link button;
    // going through isUserAuthenticated would pair the probe name for good.
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    await app.inject({ method: "GET", url: "/api/nouser/config" });
    expect(handler.calls.isKnownUser).toBe(1);
    expect(handler.calls.isUserAuthenticated).toBe(0);
  });

  it("returns unauthorized for getAllLights without auth", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/unknown-user/lights",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).toBe(1); // UNAUTHORIZED_USER
  });

  it("allows getAllLights with valid auth", async () => {
    const handler = createMockHandler({ isAuthenticated: true });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/valid-user/lights",
    });
    expect(handler.calls.getAllLights).toBe(1);
    // empty collection serializes to {}
    expect(JSON.parse(res.body)).toEqual({});
  });

  it("config endpoint does not require auth", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/any-name/config",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("bridgeid");
  });

  // D1: authenticated /config → full config; unauthenticated → reduced public config.
  it("authenticated config returns the full config (ipaddress + whitelist)", async () => {
    const handler = createMockHandler({ isAuthenticated: true });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/valid-user/config" });
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveProperty("ipaddress", "192.168.1.100");
    expect(parsed).toHaveProperty("whitelist");
  });

  it("unauthenticated config stays reduced (no ipaddress)", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/stranger/config" });
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveProperty("bridgeid");
    expect(parsed).not.toHaveProperty("ipaddress");
  });
});

describe("apiV1Routes — GET full state and single light (v1.8.1)", () => {
  it("GET /api/:username returns the full state for an authenticated user", async () => {
    const handler = createMockHandler({ isAuthenticated: true });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/valid-user" });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveProperty("lights");
    expect(parsed).toHaveProperty("config");
  });

  it("GET /api/:username is blocked for unauthenticated users", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/stranger" });
    expect(JSON.parse(res.body)[0].error.type).toBe(1); // UNAUTHORIZED_USER
  });

  it("GET /api/:username/lights/:id delegates to the handler with the id", async () => {
    const handler = createMockHandler({ isAuthenticated: true });
    const app = await buildApp(handler);
    const res = await app.inject({ method: "GET", url: "/api/valid-user/lights/3" });
    expect(res.statusCode).toBe(200);
    expect(handler.calls.getLightById).toEqual(["3"]);
    expect(JSON.parse(res.body)).toHaveProperty("state");
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
    expect(res.statusCode).toBe(200);
    expect(handler.calls.setLightState).toHaveLength(1);
    expect(handler.calls.setLightState[0].lightId).toBe("1");
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
    expect(parsed[0].error.type).toBe(2); // INVALID_JSON
    expect(handler.calls.setLightState).toHaveLength(0);
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
    expect(parsed[0]).toHaveProperty("error");
    expect(handler.calls.setLightState).toHaveLength(0);
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
    expect(parsed[0].error.type).toBe(2);
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
    expect(res.statusCode).toBe(200);
    expect(handler.calls.setGroupAction).toHaveLength(1);
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
    expect(parsed[0].error.type).toBe(2);
    expect(handler.calls.setGroupAction).toHaveLength(0);
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
    expect(handler.calls.fallback).toHaveLength(1);
    expect(res.statusCode).toBe(200);
  });

  it("returns empty object for unimplemented collections (groups)", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/user1/groups",
    });
    expect(JSON.parse(res.body)).toEqual({});
  });

  it("returns empty object for sensors", async () => {
    const handler = createMockHandler();
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/user1/sensors",
    });
    expect(JSON.parse(res.body)).toEqual({});
  });

  it("unauthorized user still blocked on empty collections", async () => {
    const handler = createMockHandler({ isAuthenticated: false });
    const app = await buildApp(handler);
    const res = await app.inject({
      method: "GET",
      url: "/api/stranger/groups",
    });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].error.type).toBe(1); // UNAUTHORIZED_USER
  });
});
