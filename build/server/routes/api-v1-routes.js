"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var api_v1_routes_exports = {};
__export(api_v1_routes_exports, {
  apiV1Routes: () => apiV1Routes
});
module.exports = __toCommonJS(api_v1_routes_exports);
var import_errors = require("../../types/errors");
var import_error_handler = require("../middleware/error-handler");
function toHueRequest(request) {
  return {
    method: request.method,
    url: request.url,
    params: request.params || {},
    body: request.body,
    headers: request.headers,
    ip: request.ip
  };
}
async function handleErrors(request, reply, handler) {
  try {
    const result = await handler();
    if (!reply.sent) {
      reply.send(result);
    }
  } catch (error) {
    if (error instanceof import_errors.HueApiError) {
      reply.status(200).send([error.toResponse()]);
    } else if (error instanceof Error) {
      const hueError = import_errors.HueApiError.internalError(error.message, request.url);
      reply.status(200).send([hueError.toResponse()]);
    } else {
      const hueError = import_errors.HueApiError.internalError("Unknown error", request.url);
      reply.status(200).send([hueError.toResponse()]);
    }
  }
}
async function apiV1Routes(fastify, options) {
  const { handler } = options;
  fastify.post("/api", async (request, reply) => {
    await handleErrors(request, reply, async () => {
      const hueReq = toHueRequest(request);
      const body = request.body;
      if (!body || !body.devicetype) {
        throw import_errors.HueApiError.missingParameters("/api");
      }
      const username = await handler.createUser(hueReq, body);
      return (0, import_error_handler.createSuccessResponse)({ username });
    });
  });
  fastify.get(
    "/api/:username",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;
        const isAuth = await handler.isUserAuthenticated(username);
        if (!isAuth && !handler.isAuthDisabled()) {
          throw import_errors.HueApiError.unauthorizedUser(`/api/${username}`);
        }
        return handler.getFullState(hueReq, username);
      });
    }
  );
  fastify.get(
    "/api/:username/config",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;
        return handler.getConfig(hueReq, username);
      });
    }
  );
  fastify.get(
    "/api/:username/lights",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username } = request.params;
        const isAuth = await handler.isUserAuthenticated(username);
        if (!isAuth && !handler.isAuthDisabled()) {
          throw import_errors.HueApiError.unauthorizedUser(`/api/${username}/lights`);
        }
        return handler.getAllLights(hueReq, username);
      });
    }
  );
  fastify.get(
    "/api/:username/lights/:id",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        const isAuth = await handler.isUserAuthenticated(username);
        if (!isAuth && !handler.isAuthDisabled()) {
          throw import_errors.HueApiError.unauthorizedUser(`/api/${username}/lights/${id}`);
        }
        return handler.getLightById(hueReq, username, id);
      });
    }
  );
  fastify.put(
    "/api/:username/lights/:id/state",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        const stateUpdate = request.body;
        const isAuth = await handler.isUserAuthenticated(username);
        if (!isAuth && !handler.isAuthDisabled()) {
          throw import_errors.HueApiError.unauthorizedUser(
            `/api/${username}/lights/${id}/state`
          );
        }
        if (!stateUpdate || typeof stateUpdate !== "object") {
          throw import_errors.HueApiError.invalidJson(`/api/${username}/lights/${id}/state`);
        }
        return handler.setLightState(hueReq, username, id, stateUpdate);
      });
    }
  );
  fastify.put(
    "/api/:username/groups/:id/action",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        const { username, id } = request.params;
        const stateUpdate = request.body;
        const isAuth = await handler.isUserAuthenticated(username);
        if (!isAuth && !handler.isAuthDisabled()) {
          throw import_errors.HueApiError.unauthorizedUser(
            `/api/${username}/groups/${id}/action`
          );
        }
        if (!stateUpdate || typeof stateUpdate !== "object") {
          throw import_errors.HueApiError.invalidJson(`/api/${username}/groups/${id}/action`);
        }
        return handler.setGroupAction(hueReq, username, id, stateUpdate);
      });
    }
  );
  for (const collection of [
    "groups",
    "schedules",
    "scenes",
    "sensors",
    "rules",
    "resourcelinks"
  ]) {
    fastify.get(
      `/api/:username/${collection}`,
      async (request, reply) => {
        await handleErrors(request, reply, async () => {
          const { username } = request.params;
          const isAuth = await handler.isUserAuthenticated(username);
          if (!isAuth && !handler.isAuthDisabled()) {
            throw import_errors.HueApiError.unauthorizedUser(
              `/api/${username}/${collection}`
            );
          }
          return {};
        });
      }
    );
  }
  fastify.all(
    "/api/*",
    async (request, reply) => {
      await handleErrors(request, reply, async () => {
        const hueReq = toHueRequest(request);
        return handler.fallback(hueReq);
      });
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  apiV1Routes
});
//# sourceMappingURL=api-v1-routes.js.map
