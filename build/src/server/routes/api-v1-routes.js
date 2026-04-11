"use strict";
/**
 * Hue API v1 Routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiV1Routes = apiV1Routes;
const errors_1 = require("../../types/errors");
const error_handler_1 = require("../middleware/error-handler");
/**
 * Convert Fastify request to HueRequest
 */
function toHueRequest(request) {
    return {
        method: request.method,
        url: request.url,
        params: request.params || {},
        body: request.body,
        headers: request.headers,
        ip: request.ip,
    };
}
/**
 * Error handler wrapper for async route handlers
 */
async function handleErrors(request, reply, handler) {
    try {
        const result = await handler();
        if (!reply.sent) {
            reply.send(result);
        }
    }
    catch (error) {
        if (error instanceof errors_1.HueApiError) {
            reply.status(200).send([error.toResponse()]);
        }
        else if (error instanceof Error) {
            const hueError = errors_1.HueApiError.internalError(error.message, request.url);
            reply.status(200).send([hueError.toResponse()]);
        }
        else {
            const hueError = errors_1.HueApiError.internalError("Unknown error", request.url);
            reply.status(200).send([hueError.toResponse()]);
        }
    }
}
/**
 * Fastify plugin that registers all Hue API v1 routes
 */
async function apiV1Routes(fastify, options) {
    const { handler } = options;
    // POST /api - Create user
    fastify.post("/api", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const body = request.body;
            if (!body || !body.devicetype) {
                throw errors_1.HueApiError.missingParameters("/api");
            }
            const username = await handler.createUser(hueReq, body);
            return (0, error_handler_1.createSuccessResponse)({ username });
        });
    });
    // GET /api/:username - Get full state
    fastify.get("/api/:username", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username } = request.params;
            const isAuth = await handler.isUserAuthenticated(username);
            if (!isAuth && !handler.isAuthDisabled()) {
                throw errors_1.HueApiError.unauthorizedUser(`/api/${username}`);
            }
            return handler.getFullState(hueReq, username);
        });
    });
    // GET /api/:username/config - Get config
    fastify.get("/api/:username/config", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username } = request.params;
            // Config endpoint doesn't require auth for basic info
            return handler.getConfig(hueReq, username);
        });
    });
    // GET /api/:username/lights - Get all lights
    fastify.get("/api/:username/lights", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username } = request.params;
            const isAuth = await handler.isUserAuthenticated(username);
            if (!isAuth && !handler.isAuthDisabled()) {
                throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights`);
            }
            return handler.getAllLights(hueReq, username);
        });
    });
    // GET /api/:username/lights/:id - Get single light
    fastify.get("/api/:username/lights/:id", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username, id } = request.params;
            const isAuth = await handler.isUserAuthenticated(username);
            if (!isAuth && !handler.isAuthDisabled()) {
                throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights/${id}`);
            }
            return handler.getLightById(hueReq, username, id);
        });
    });
    // PUT /api/:username/lights/:id/state - Set light state
    fastify.put("/api/:username/lights/:id/state", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username, id } = request.params;
            const stateUpdate = request.body;
            const isAuth = await handler.isUserAuthenticated(username);
            if (!isAuth && !handler.isAuthDisabled()) {
                throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights/${id}/state`);
            }
            if (!stateUpdate || typeof stateUpdate !== "object") {
                throw errors_1.HueApiError.invalidJson(`/api/${username}/lights/${id}/state`);
            }
            return handler.setLightState(hueReq, username, id, stateUpdate);
        });
    });
    // PUT /api/:username/groups/:id/action - Set group action (e.g. Harmony Hub)
    fastify.put("/api/:username/groups/:id/action", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            const { username, id } = request.params;
            const stateUpdate = request.body;
            const isAuth = await handler.isUserAuthenticated(username);
            if (!isAuth && !handler.isAuthDisabled()) {
                throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/groups/${id}/action`);
            }
            if (!stateUpdate || typeof stateUpdate !== "object") {
                throw errors_1.HueApiError.invalidJson(`/api/${username}/groups/${id}/action`);
            }
            return handler.setGroupAction(hueReq, username, id, stateUpdate);
        });
    });
    // Empty collections (not implemented): groups, schedules, scenes, sensors, rules, resourcelinks
    for (const collection of [
        "groups",
        "schedules",
        "scenes",
        "sensors",
        "rules",
        "resourcelinks",
    ]) {
        fastify.get(`/api/:username/${collection}`, async (request, reply) => {
            await handleErrors(request, reply, async () => {
                const { username } = request.params;
                const isAuth = await handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/${collection}`);
                }
                return {};
            });
        });
    }
    // Fallback for unhandled API routes
    fastify.all("/api/*", async (request, reply) => {
        await handleErrors(request, reply, async () => {
            const hueReq = toHueRequest(request);
            return handler.fallback(hueReq);
        });
    });
}
//# sourceMappingURL=api-v1-routes.js.map