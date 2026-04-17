/**
 * Hue API v1 Routes
 */

import type {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import type {
  HueApiHandler,
  HueRequest,
  CreateUserRequest,
  LightStateUpdate,
} from "../../types";
import { HueApiError } from "../../types/errors";
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
 */
function toHueRequest(request: FastifyRequest): HueRequest {
  return {
    method: request.method,
    url: request.url,
    params: (request.params as Record<string, string>) || {},
    body: request.body,
    headers: request.headers as Record<string, string | string[] | undefined>,
    ip: request.ip,
  };
}

/**
 * Error handler wrapper for async route handlers
 */
async function handleErrors(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<unknown>,
): Promise<void> {
  try {
    const result = await handler();
    if (!reply.sent) {
      reply.send(result);
    }
  } catch (error) {
    if (error instanceof HueApiError) {
      reply.status(200).send([error.toResponse()]);
    } else if (error instanceof Error) {
      const hueError = HueApiError.internalError(error.message, request.url);
      reply.status(200).send([hueError.toResponse()]);
    } else {
      const hueError = HueApiError.internalError("Unknown error", request.url);
      reply.status(200).send([hueError.toResponse()]);
    }
  }
}

/**
 * Verify the user is authenticated (or auth is disabled).
 * Throws HueApiError.unauthorizedUser if not.
 */
async function requireAuth(
  handler: HueApiHandler,
  username: string,
  address: string,
): Promise<void> {
  const isAuth = await handler.isUserAuthenticated(username);
  if (!isAuth && !handler.isAuthDisabled()) {
    throw HueApiError.unauthorizedUser(address);
  }
}

/**
 * Fastify plugin that registers all Hue API v1 routes
 */
export async function apiV1Routes(
  fastify: FastifyInstance,
  options: ApiRoutesOptions,
): Promise<void> {
  const { handler } = options;

  // POST /api - Create user
  fastify.post("/api", async (request: FastifyRequest, reply: FastifyReply) => {
    await handleErrors(request, reply, async () => {
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

  // GET /api/:username - Get full state
  fastify.get<{ Params: UsernameParams }>(
    "/api/:username",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;
        await requireAuth(handler, username, `/api/${username}`);
        return handler.getFullState(hueReq, username);
      });
    },
  );

  // GET /api/:username/config - Get config
  fastify.get<{ Params: UsernameParams }>(
    "/api/:username/config",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;

        // Config endpoint doesn't require auth for basic info
        return handler.getConfig(hueReq, username);
      });
    },
  );

  // GET /api/:username/lights - Get all lights
  fastify.get<{ Params: UsernameParams }>(
    "/api/:username/lights",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;
        await requireAuth(handler, username, `/api/${username}/lights`);
        return handler.getAllLights(hueReq, username);
      });
    },
  );

  // GET /api/:username/lights/:id - Get single light
  fastify.get<{ Params: LightParams }>(
    "/api/:username/lights/:id",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        await requireAuth(handler, username, `/api/${username}/lights/${id}`);
        return handler.getLightById(hueReq, username, id);
      });
    },
  );

  // PUT /api/:username/lights/:id/state - Set light state
  fastify.put<{ Params: LightParams }>(
    "/api/:username/lights/:id/state",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        const stateUpdate = request.body as LightStateUpdate;
        await requireAuth(
          handler,
          username,
          `/api/${username}/lights/${id}/state`,
        );

        if (
          !stateUpdate ||
          typeof stateUpdate !== "object" ||
          Array.isArray(stateUpdate)
        ) {
          throw HueApiError.invalidJson(`/api/${username}/lights/${id}/state`);
        }

        return handler.setLightState(hueReq, username, id, stateUpdate);
      });
    },
  );

  // PUT /api/:username/groups/:id/action - Set group action (e.g. Harmony Hub)
  fastify.put<{ Params: LightParams }>(
    "/api/:username/groups/:id/action",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        const stateUpdate = request.body as LightStateUpdate;
        await requireAuth(
          handler,
          username,
          `/api/${username}/groups/${id}/action`,
        );

        if (
          !stateUpdate ||
          typeof stateUpdate !== "object" ||
          Array.isArray(stateUpdate)
        ) {
          throw HueApiError.invalidJson(`/api/${username}/groups/${id}/action`);
        }

        return handler.setGroupAction(hueReq, username, id, stateUpdate);
      });
    },
  );

  // Empty collections (not implemented): groups, schedules, scenes, sensors, rules, resourcelinks
  for (const collection of [
    "groups",
    "schedules",
    "scenes",
    "sensors",
    "rules",
    "resourcelinks",
  ]) {
    fastify.get<{ Params: UsernameParams }>(
      `/api/:username/${collection}`,
      async (request, reply) => {
        await handleErrors(request, reply, async () => {
          const { username } = request.params;
          await requireAuth(
            handler,
            username,
            `/api/${username}/${collection}`,
          );
          return {};
        });
      },
    );
  }

  // Fallback for unhandled API routes
  fastify.all(
    "/api/*",
    async (request: FastifyRequest, reply: FastifyReply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        return handler.fallback(hueReq);
      });
    },
  );
}
