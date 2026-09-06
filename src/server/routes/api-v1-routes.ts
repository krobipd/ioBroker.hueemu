/**
 * Hue API v1 Routes
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import type { HueApiHandler, HueRequest, CreateUserRequest, LightStateUpdate } from "../../types";
import type { Logger } from "../../types/config";
import { HueApiError } from "../../types/errors";
import { createSuccessResponse } from "../middleware/error-handler";

/**
 * Options for the API routes plugin
 */
export interface ApiRoutesOptions extends FastifyPluginOptions {
  /** API handler implementation */
  handler: HueApiHandler;
  /**
   * Optional adapter logger. When provided, `handleErrors` emits a `debug`
   * line for every error converged via the route-level catch — production
   * wires this in `hue-server.ts`. Tests omit it for backward compatibility
   * (no log assertions in existing tests).
   */
  logger?: Logger;
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
 * Error handler wrapper for async route handlers.
 *
 * v1.4.5 (D + E): the optional `logger` parameter emits a debug trace for every
 * converged error — requireAuth throws, route-handler throws, body validation.
 * Without it the route-level error convergence was completely silent. The logger
 * is optional (tests pass a handler without one).
 *
 * @param request - Fastify request object
 * @param reply - Fastify reply object
 * @param handler - Async route handler function
 * @param logger - Optional logger for debug output
 */
async function handleErrors(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => unknown,
  logger?: Logger,
): Promise<void> {
  try {
    const result = await handler();
    if (!reply.sent) {
      reply.send(result);
    }
  } catch (error) {
    if (error instanceof HueApiError) {
      logger?.debug(`Hue API error: ${request.method} ${request.url} → ${String(error.type)} (${error.message})`);
      reply.status(200).send([error.toResponse()]);
    } else if (error instanceof Error) {
      logger?.debug(`Hue API error: ${request.method} ${request.url} → internal_error (${error.message})`);
      const hueError = HueApiError.internalError(error.message, request.url);
      reply.status(200).send([hueError.toResponse()]);
    } else {
      logger?.debug(`Hue API error: ${request.method} ${request.url} → unknown (${String(error)})`);
      const hueError = HueApiError.internalError("Unknown error", request.url);
      reply.status(200).send([hueError.toResponse()]);
    }
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
 * @param options - Plugin options with handler and logger
 */
export function apiV1Routes(fastify: FastifyInstance, options: ApiRoutesOptions): void {
  const { handler, logger } = options;

  // Local helper closure that captures `logger` from plugin options — saves
  // passing the logger through all call-sites of `handleErrors`.
  async function runWithLog(req: FastifyRequest, rep: FastifyReply, fn: () => unknown): Promise<void> {
    return handleErrors(req, rep, fn, logger);
  }

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
    return runWithLog(req, rep, async () => {
      const params = req.params as LightParams;
      await requireAuth(handler, params.username, `/api/${params.username}${suffix(params)}`);
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
    await runWithLog(request, reply, async () => {
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
        throw HueApiError.missingParameters("/api");
      }

      const body = raw as CreateUserRequest;
      const username = await handler.createUser(hueReq, body);
      return createSuccessResponse({ username });
    });
  });

  // GET /api/config - Public bridge config without a username. Real bridges
  // answer this unauthenticated (discovery clients call it before pairing);
  // the static route wins over /api/:username, so "config" is never taken
  // for a username.
  fastify.get("/api/config", async (request: FastifyRequest, reply: FastifyReply) => {
    await runWithLog(request, reply, () => handler.getConfig(toHueRequest(request), ""));
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
    await runWithLog(request, reply, async () => {
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
        const address = `/api/${p.username}/lights/${p.id}/state`;
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
        const address = `/api/${p.username}/groups/${p.id}/action`;
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

  // Fallback for unhandled API routes
  fastify.all("/api/*", async (request: FastifyRequest, reply: FastifyReply) => {
    await runWithLog(request, reply, () => {
      const hueReq = toHueRequest(request);
      return handler.fallback(hueReq);
    });
  });
}
