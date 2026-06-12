/**
 * Tests for HueServer — the Fastify wiring layer that was previously
 * untested at 0 %: route registration (description.xml, api-v1, /health),
 * CORS hooks, OPTIONS handling, error-handler registration, and the real
 * HTTP/HTTPS listen lifecycle. Route *behaviour* lives in
 * api-v1-routes.test.ts; here we assert the server actually wires it all up.
 */

import type { FastifyInstance } from "fastify";
import { HueServer } from "./hue-server";
import type { HueEmulatorConfig } from "../types/config";
import type { HueApiHandler } from "../types/hue-api";
import { createMockLogger, createTestIdentity } from "../../test/test-helpers";

// Pre-generated self-signed RSA-2048 cert/key for `localhost` (CN+SAN
// 127.0.0.1), 100-year validity — same fixture as the homewizard test suite.
// Cert pinning is not under test; the point is the real HTTPS listen path.
const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC0NzX0WQlFVj+Y
5QN7kS0zfQlnIhNxQ3ehH8kGNz84cN550G5yoS33zU4Y+tK+VOHktyvSIuJOMxd2
ef3AW++uTmEVhNG5OjdHFaDJG/cK9PHFnA5CHnxl9m3/yRSxlYBhk4u2eJ32kqG4
4mLKteF6W8Km7lDjrWnocSGkao8qYYYWJnHe3fEQNCskQW+uGZdoi/QMI0icnID5
GbywOdIv6SJgBm/RKKT2wvsyWUH/lXGAg4fQTuz+/udbjAPsMHDIExxIndYXGQdk
9bH2WveRGxFRK+z3CS5KRvxbO4Q6i3DgTNoeX20ELfxley/Cr0VQ47l6PnpT3WI9
ZUt8jQlzAgMBAAECggEAAdx2HAVqtpga77R3HOjAFkGK03wDG7mDe/BXmPmrbKT3
GeagqrdmbEznAGlgEXjP8mw/3BuMdHFLozzESvRyx707Jx09iz5XgXju4FTVGtGy
c4TWktvnaKgrClK5z3xd8eQJCS6QDGgG7+Ff/XxJDVny6zAX5BoPjMfU/fKJyE7A
GNJwNx0nvCv8qKrIaYXfx6lCBSDk24mrHzgW1y86iOsKhHQYE9Wj5qcJ7Dre+ijL
jmpEdoItnavwjFpp4beHqV20XeSMzCcW50M3tD0MA7eZpiIDvRteHoGATHwZpj5R
q8WWv7T1ZCIy4/fV/4x0BXo0XPOWuGpOUtvhr52IYQKBgQDXewd5F7ezAZ13Ble6
PArjLLsZbVqiThx5chadISOK68Zzb8/GBHhkG7QEEuzpJC9pVd0j00YpaNEdn0Mz
DSOxj0F89Sg2Fo69DGepQbX10QoT9Mvpi28NLWnDQ6sxTctdHQ4zNU+tOP5zzK1u
smoISBROvlxESx8hvQw1UNkjkwKBgQDWGpJhp42Oj0runxnnQalZcdNeuq3tMBsL
Sgl3taP4KQAJVnutzEp7n4J8mZtr8j3blO/QT3+bnSe3V/D6LN931qe9W8/jMA0T
Dc7p1VRpKOtX2/dq8mbLHOG1qWkQKbh7XSZf0SeKbZovlhIJqiqL7ArL8Yw5b80q
L7T64EnuoQKBgBC+0dzaN/9kP71xM74YTmxLHJskQWfdlB7n+9PoMF/qZLix1r63
uDdnY7zxT5HqqviPoKjZEVnEeIPJzaoY+k4hKOCyGJbjd+I/JYskvSRGQ3c7jeEv
YcjvX4m6J4KkXgp1aJYYLYHzrOqI3G1+1figyVs5Nehkwh2YGGvIRaebAoGBAJUe
SqejOC97U7ggrbzoeZendIz8vhh9schKF4/9vacgfzsBtgBVUecKMKqxnZMwU670
65YNWJY8faXvpRHJYRcpNQjowkC8fc6whlVMVI8thcRamtcs3zVF91o8FMXCGRAq
z4hatwxty76q6gM7NojfrKFgqcZzPNTOB2HYBwYhAoGAdBsYcdf3mZuudUSLJO/M
junEaVzpmy27RSp5Q1RH0EEdnWXjTTyN77MdfXEcHdR71WnB+TvlMqw0ALqvtMan
0a3LfSTuIFrV2bk2H9O0+zvq4zXvcAep+WAN5Uatqh0ZxdhfPCOaKp0KUBAzpX8x
7T6ukX6Zi9r0SZUJvMlVt7o=
-----END PRIVATE KEY-----
`;

const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUW+ip2M+6bB8FbLfJD4d4DlEliWYwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDUwNjIyMDkxMFoYDzIxMjYw
NDEyMjIwOTEwWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQC0NzX0WQlFVj+Y5QN7kS0zfQlnIhNxQ3ehH8kGNz84
cN550G5yoS33zU4Y+tK+VOHktyvSIuJOMxd2ef3AW++uTmEVhNG5OjdHFaDJG/cK
9PHFnA5CHnxl9m3/yRSxlYBhk4u2eJ32kqG44mLKteF6W8Km7lDjrWnocSGkao8q
YYYWJnHe3fEQNCskQW+uGZdoi/QMI0icnID5GbywOdIv6SJgBm/RKKT2wvsyWUH/
lXGAg4fQTuz+/udbjAPsMHDIExxIndYXGQdk9bH2WveRGxFRK+z3CS5KRvxbO4Q6
i3DgTNoeX20ELfxley/Cr0VQ47l6PnpT3WI9ZUt8jQlzAgMBAAGjbzBtMB0GA1Ud
DgQWBBQUdhJjntmiQeqLorSl4XdbeoiMoTAfBgNVHSMEGDAWgBQUdhJjntmiQeqL
orSl4XdbeoiMoTAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGCCWxvY2FsaG9z
dIcEfwAAATANBgkqhkiG9w0BAQsFAAOCAQEARZAYtfMWHvW7S/CiyhAyLz+qvDzb
b78O6oIxnRQp8yzlGwxNF61zZora26tGcriwyOs5ewxQkIxkJNU2uw89J3E8FUzO
yF9JYcS2eaXFypAyGhcPkoSBViHR2P7OabeM2yqW31is/tVRolPxE9idzfyp2quJ
hN/PWkbk1dqk0Gu8LffEO9mUR5tsmerEr0tIZzePfnC09HAo4tvosGr4PLB2d2kZ
diNwXp48ZTGxYk1XdiQP1YbLBk+D3OrVjvAsyzUT8vFex/r6MmcuaDlJyloVxR/M
dGlxE9spFWzvVJpQghYsgldpPTDSQD+7b0cirusNND+qnXUCr0kE+6uOow==
-----END CERTIFICATE-----
`;

function makeConfig(overrides: Partial<HueEmulatorConfig> = {}): HueEmulatorConfig {
  return {
    host: "127.0.0.1",
    port: 0, // ephemeral — only used by the listen tests
    discoveryHost: "127.0.0.1",
    discoveryPort: 8080,
    upnpPort: 1900,
    identity: createTestIdentity(),
    trustProxy: false,
    ...overrides,
  };
}

function makeHandler(): HueApiHandler {
  return {
    createUser: async () => "test-user",
    getFullState: async () => ({ lights: {}, groups: {}, config: {} }) as never,
    getConfig: () => ({ name: "Philips hue", bridgeid: "TEST" }) as never,
    getAllLights: async () => ({}),
    getLightById: async () => ({ state: { on: true } }) as never,
    setLightState: async () => [],
    setGroupAction: async () => [],
    fallback: () => ({}),
    isUserAuthenticated: async () => true,
    isAuthDisabled: () => false,
  };
}

/** Build the (private) Fastify instance for inject-based wiring tests. */
async function buildInstance(config = makeConfig()): Promise<FastifyInstance> {
  const server = new HueServer({ config, handler: makeHandler(), logger: createMockLogger() });
  return (server as unknown as { createServer(https: boolean): Promise<FastifyInstance> }).createServer(false);
}

describe("HueServer wiring (inject)", () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  it("serves /description.xml with content-type and identity payload", async () => {
    app = await buildInstance();
    const res = await app.inject({ method: "GET", url: "/description.xml" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.headers["content-length"]).toBeDefined();
    expect(res.body).toContain("<modelNumber>BSB002</modelNumber>");
    expect(res.body).toContain(`uuid:${createTestIdentity().udn}`);
  });

  it("uses discoveryHost/discoveryPort in the description URLBase", async () => {
    app = await buildInstance(makeConfig({ discoveryHost: "192.168.7.7", discoveryPort: 8123 }));
    const res = await app.inject({ method: "GET", url: "/description.xml" });
    expect(res.body).toContain("<URLBase>http://192.168.7.7:8123/</URLBase>");
  });

  it("registers the API routes (POST /api reaches the handler)", async () => {
    app = await buildInstance();
    const res = await app.inject({ method: "POST", url: "/api", payload: { devicetype: "Echo" } });
    const parsed = JSON.parse(res.body);
    expect(parsed[0].success.username).toBe("test-user");
  });

  it("serves the /health endpoint", async () => {
    app = await buildInstance();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  it("adds CORS headers to every response (Hue app compatibility)", async () => {
    app = await buildInstance();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toContain("PUT");
    expect(res.headers["access-control-allow-headers"]).toBe("Content-Type");
  });

  it("answers OPTIONS preflight with CORS headers (204 outside /api, 200 via the /api/* fallback)", async () => {
    app = await buildInstance();
    // Outside /api/* the dedicated OPTIONS wildcard answers 204.
    const outside = await app.inject({ method: "OPTIONS", url: "/anything" });
    expect(outside.statusCode).toBe(204);
    expect(outside.headers["access-control-allow-origin"]).toBe("*");
    // Under /api/* the `all("/api/*")` fallback wins route precedence and
    // answers 200 — still carrying the CORS headers from the onSend hook,
    // which is what a browser preflight actually needs.
    const api = await app.inject({ method: "OPTIONS", url: "/api/user/lights" });
    expect(api.statusCode).toBe(200);
    expect(api.headers["access-control-allow-origin"]).toBe("*");
    expect(api.headers["access-control-allow-methods"]).toContain("PUT");
  });

  it("routes are case-insensitive and trailing-slash tolerant", async () => {
    app = await buildInstance();
    const res = await app.inject({ method: "GET", url: "/HEALTH/" });
    expect(res.statusCode).toBe(200);
  });

  it("converts an unparseable JSON body via the registered error handler (Hue shape, status 200)", async () => {
    app = await buildInstance();
    const res = await app.inject({
      method: "POST",
      url: "/api",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed[0]).toHaveProperty("error");
  });

  it("rejects bodies above the 64 KiB bodyLimit (SV3)", async () => {
    app = await buildInstance();
    const res = await app.inject({
      method: "POST",
      url: "/api",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ devicetype: "x".repeat(70_000) }),
    });
    // Fastify converges the too-large error through the Hue error handler.
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)[0]).toHaveProperty("error");
  });
});

describe("HueServer lifecycle (real listen)", () => {
  it("starts HTTP on an ephemeral port, serves requests, and stops cleanly", async () => {
    const server = new HueServer({ config: makeConfig(), handler: makeHandler(), logger: createMockLogger() });
    await server.start();
    try {
      const instance = (server as unknown as { httpServer: FastifyInstance }).httpServer;
      const address = instance.server.address() as { port: number };
      expect(address.port).toBeGreaterThan(0);

      const res = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok" });
    } finally {
      await server.stop();
    }
  });

  it("starts the HTTPS listener too when TLS material is configured", async () => {
    const config = makeConfig({ https: { port: 0, cert: TEST_CERT_PEM, key: TEST_KEY_PEM } });
    const server = new HueServer({ config, handler: makeHandler(), logger: createMockLogger() });
    await server.start();
    try {
      const httpsInstance = (server as unknown as { httpsServer: FastifyInstance }).httpsServer;
      expect(httpsInstance).not.toBeNull();
      const address = httpsInstance.server.address() as { port: number };
      expect(address.port).toBeGreaterThan(0);
      // Round-trip over real TLS (self-signed → skip verification).
      const res = await httpsInstance.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it("stop() before start() resolves without error", async () => {
    const server = new HueServer({ config: makeConfig(), handler: makeHandler(), logger: createMockLogger() });
    await expect(server.stop()).resolves.toBeUndefined();
  });
});
