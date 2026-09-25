/**
 * Hue API v1 Routes
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import type { HueApiHandler, HueRequest, CreateUserRequest, LightStateUpdate } from "../../types";
import { HueApiError } from "../../types/errors";
import { randomBytes } from "node:crypto";
import { createSuccessResponse } from "../middleware/error-handler";

/**
 * Options for the API routes plugin
 */
export interface ApiRoutesOptions extends FastifyPluginOptions {
  /** API handler implementation */
  handler: HueApiHandler;
}

/**
 * Route params interfaces
 */
interface UsernameParams {
  username: string;
}

interface LightParams {
  username: string;
  id: string;
}

/**
 * Convert Fastify request to HueRequest
 *
 * @param request - Fastify request to convert
 */
function toHueRequest(request: FastifyRequest): HueRequest {
  return {
    method: request.method,
    url: request.url,
    params: (request.params as Record<string, string>) || {},
    body: request.body,
    headers: request.headers,
    ip: request.ip,
  };
}

/**
 * Run a route body and send its result.
 *
 * @param reply - Fastify reply object
 * @param handler - Async route handler function
 */
async function sendResult(reply: FastifyReply, handler: () => unknown): Promise<void> {
  // A rejection propagates to the server-level error handler (`hueErrorHandler`),
  // which maps HueApiError → its Hue error entry and anything else → 901 — the
  // same mapping this function used to repeat (audit 2026-09-15 E1).
  const result = await handler();
  if (!reply.sent) {
    reply.send(result);
  }
}

/**
 * Verify the user is authenticated (or auth is disabled).
 * Throws HueApiError.unauthorizedUser if not.
 *
 * @param handler - API handler to check auth against
 * @param username - Username to verify
 * @param address - API address for error reporting
 */
async function requireAuth(handler: HueApiHandler, username: string, address: string): Promise<void> {
  const isAuth = await handler.isUserAuthenticated(username);
  if (!isAuth && !handler.isAuthDisabled()) {
    throw HueApiError.unauthorizedUser(address);
  }
}

/**
 * Fastify plugin that registers all Hue API v1 routes
 *
 * @param fastify - Fastify instance to register routes on
 * @param options - Plugin options with the handler
 */
export function apiV1Routes(fastify: FastifyInstance, options: ApiRoutesOptions): void {
  const { handler } = options;

  // v1.19.0 (audit 2026-09-25 K2): a Hue body is JSON whatever the request calls it.
  // Clients built on phue send no Content-Type at all, curl -d sends
  // application/x-www-form-urlencoded — Fastify answered both with "Unsupported Media
  // Type" (Hue error 901), so pairing and switching failed. The real bridge, diyHue
  // (get_json(force=True)), Home Assistant's emulated_hue, Tasmota and Espalexa all
  // read the body regardless. `*` also catches a request without the header; Fastify's
  // own JSON parser keeps the prototype-poisoning guard.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser("*", { parseAs: "string" }, fastify.getDefaultJsonParser("error", "error"));

  /**
   * Run a route body that requires a paired client: read the params, build the
   * Hue address the error would name, verify the username, then hand the body
   * what it needs. Every authenticated route repeated those four lines.
   *
   * @param req - Fastify request
   * @param rep - Fastify reply
   * @param suffix - The part of the Hue address after `/api/<username>`
   * @param fn - The route body
   */
  async function authed(
    req: FastifyRequest,
    rep: FastifyReply,
    suffix: (params: LightParams) => string,
    fn: (hueReq: HueRequest, params: LightParams) => unknown,
  ): Promise<void> {
    return sendResult(rep, async () => {
      const params = req.params as LightParams;
      // The bridge names the resource below the user (Q8, v1.19.0).
      await requireAuth(handler, params.username, suffix(params) || "/");
      return fn(toHueRequest(req), params);
    });
  }

  /**
   * A request body must be a plain object — an array or a scalar is invalid JSON
   * as far as the Hue API is concerned.
   *
   * @param body - The parsed request body
   * @param address - The Hue address the error names
   * @returns the body, typed
   */
  function requireObjectBody(body: unknown, address: string): LightStateUpdate {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw HueApiError.invalidJson(address);
    }
    return body;
  }

  // POST /api - Create user
  fastify.post("/api", async (request: FastifyRequest, reply: FastifyReply) => {
    await sendResult(reply, async () => {
      const hueReq = toHueRequest(request);
      const raw = request.body;

      // Body must be a plain object with a non-empty string devicetype
      if (
        !raw ||
        typeof raw !== "object" ||
        Array.isArray(raw) ||
        typeof (raw as Record<string, unknown>).devicetype !== "string" ||
        ((raw as Record<string, unknown>).devicetype as string).length === 0
      ) {
        throw HueApiError.missingParameters("");
      }

      const body = raw as CreateUserRequest;
      const username = await handler.createUser(hueReq, body);
      // v1.19.0 (audit 2026-09-25 Q7): a client that asks for a client key gets one,
      // like from the bridge and diyHue. The emulator offers no Entertainment
      // streaming, the only thing the key is used for — but the answer is complete.
      if (body.generateclientkey === true) {
        return createSuccessResponse({ username, clientkey: randomBytes(16).toString("hex").toUpperCase() });
      }
      return createSuccessResponse({ username });
    });
  });

  // GET /api/config - Public bridge config without a username. Real bridges
  // answer this unauthenticated (discovery clients call it before pairing);
  // the static route wins over /api/:username, so "config" is never taken
  // for a username.
  fastify.get("/api/config", async (request: FastifyRequest, reply: FastifyReply) => {
    await sendResult(reply, () => handler.getConfig(toHueRequest(request), ""));
  });

  // GET /api/:username - Get full state
  fastify.get<{ Params: UsernameParams }>("/api/:username", async (request, reply) => {
    await authed(
      request,
      reply,
      () => "",
      (hueReq, p) => handler.getFullState(hueReq, p.username),
    );
  });

  // GET /api/:username/config - Get config. Real Hue returns the FULL config
  // (whitelist, ipaddress, timezone…) to an authenticated user and the reduced
  // public config to an unknown one — never a 401, /config stays reachable.
  // Pure lookup on purpose: this route must never auto-add a client during the
  // pairing window — discovery apps poll /api/nouser/config while waiting, and
  // the well-known probe name would become a valid key.
  fastify.get<{ Params: UsernameParams }>("/api/:username/config", async (request, reply) => {
    await sendResult(reply, async () => {
      const hueReq = toHueRequest(request);
      const { username } = request.params;
      const authed = handler.isAuthDisabled() || (await handler.isKnownUser(username));
      return authed ? handler.getFullConfig(hueReq, username) : handler.getConfig(hueReq, username);
    });
  });

  // GET /api/:username/lights - Get all lights
  fastify.get<{ Params: UsernameParams }>("/api/:username/lights", async (request, reply) => {
    await authed(
      request,
      reply,
      () => "/lights",
      (hueReq, p) => handler.getAllLights(hueReq, p.username),
    );
  });

  // GET /api/:username/lights/:id - Get single light
  fastify.get<{ Params: LightParams }>("/api/:username/lights/:id", async (request, reply) => {
    await authed(
      request,
      reply,
      p => `/lights/${p.id}`,
      (hueReq, p) => handler.getLightById(hueReq, p.username, p.id),
    );
  });

  // PUT /api/:username/lights/:id/state - Set light state
  fastify.put<{ Params: LightParams }>("/api/:username/lights/:id/state", async (request, reply) => {
    await authed(
      request,
      reply,
      p => `/lights/${p.id}/state`,
      (hueReq, p) => {
        const address = `/lights/${p.id}/state`;
        return handler.setLightState(hueReq, p.username, p.id, requireObjectBody(request.body, address));
      },
    );
  });

  // PUT /api/:username/groups/:id/action - Set group action (e.g. Harmony Hub)
  fastify.put<{ Params: LightParams }>("/api/:username/groups/:id/action", async (request, reply) => {
    await authed(
      request,
      reply,
      p => `/groups/${p.id}/action`,
      (hueReq, p) => {
        const address = `/groups/${p.id}/action`;
        return handler.setGroupAction(hueReq, p.username, p.id, requireObjectBody(request.body, address));
      },
    );
  });

  // Empty collections (not implemented): groups, schedules, scenes, sensors, rules, resourcelinks
  for (const collection of ["groups", "schedules", "scenes", "sensors", "rules", "resourcelinks"]) {
    fastify.get<{ Params: UsernameParams }>(`/api/:username/${collection}`, async (request, reply) => {
      await authed(
        request,
        reply,
        () => `/${collection}`,
        () => ({}),
      );
    });
  }

  // GET /api without a user — the bridge answers error 4 (diyHue: `method, GET, not
  // available for resource, /`); it used to be Fastify's own 404 page (Q9, v1.19.0).
  fastify.get("/api", async (_request: FastifyRequest, reply: FastifyReply) => {
    await sendResult(reply, () => {
      throw HueApiError.methodNotAvailable("GET", "/", "/api");
    });
  });

  // Fallback for unhandled API routes. v1.19.0 (audit 2026-09-25 Q9): it answered `{}`
  // to anyone, on any method. Now like the bridge: an unknown user gets error 1, a
  // known one error 3 for a resource the emulator does not have. The check is the pure
  // lookup (never the auto-adding path): a probe on `/api/nouser/…` during the pairing
  // window must not become a paired client (decision 10). A CORS preflight still gets
  // its empty answer — the headers come from the server's onSend hook.
  fastify.all("/api/*", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }
    await sendResult(reply, async () => {
      const hueReq = toHueRequest(request);
      const [username = "", ...rest] = (request.url.split("?")[0] ?? "").replace(/^\/api\/?/i, "").split("/");
      const resource = `/${rest.filter(Boolean).join("/")}`;
      if (!handler.isAuthDisabled() && !(await handler.isKnownUser(username))) {
        throw HueApiError.unauthorizedUser("/");
      }
      handler.fallback(hueReq); // the debug line naming the unhandled request
      throw HueApiError.resourceNotAvailable(resource, resource);
    });
  });
}
