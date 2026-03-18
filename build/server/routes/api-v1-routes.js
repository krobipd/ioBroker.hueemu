"use strict";
/**
 * Hue API v1 Routes
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
function handleErrors(request, reply, handler) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const result = yield handler();
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
    });
}
/**
 * Fastify plugin that registers all Hue API v1 routes
 */
function apiV1Routes(fastify, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { handler } = options;
        // POST /api - Create user
        fastify.post("/api", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const body = request.body;
                if (!body || !body.devicetype) {
                    throw errors_1.HueApiError.missingParameters("/api");
                }
                const username = yield handler.createUser(hueReq, body);
                return (0, error_handler_1.createSuccessResponse)({ username });
            }));
        }));
        // GET /api/:username - Get full state
        fastify.get("/api/:username", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username } = request.params;
                const isAuth = yield handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}`);
                }
                return handler.getFullState(hueReq, username);
            }));
        }));
        // GET /api/:username/config - Get config
        fastify.get("/api/:username/config", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username } = request.params;
                // Config endpoint doesn't require auth for basic info
                return handler.getConfig(hueReq, username);
            }));
        }));
        // GET /api/:username/lights - Get all lights
        fastify.get("/api/:username/lights", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username } = request.params;
                const isAuth = yield handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights`);
                }
                return handler.getAllLights(hueReq, username);
            }));
        }));
        // GET /api/:username/lights/:id - Get single light
        fastify.get("/api/:username/lights/:id", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username, id } = request.params;
                const isAuth = yield handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights/${id}`);
                }
                return handler.getLightById(hueReq, username, id);
            }));
        }));
        // PUT /api/:username/lights/:id/state - Set light state
        fastify.put("/api/:username/lights/:id/state", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username, id } = request.params;
                const stateUpdate = request.body;
                const isAuth = yield handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/lights/${id}/state`);
                }
                if (!stateUpdate || typeof stateUpdate !== "object") {
                    throw errors_1.HueApiError.invalidJson(`/api/${username}/lights/${id}/state`);
                }
                return handler.setLightState(hueReq, username, id, stateUpdate);
            }));
        }));
        // PUT /api/:username/groups/:id/action - Set group action (e.g. Harmony Hub)
        fastify.put("/api/:username/groups/:id/action", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                const { username, id } = request.params;
                const stateUpdate = request.body;
                const isAuth = yield handler.isUserAuthenticated(username);
                if (!isAuth && !handler.isAuthDisabled()) {
                    throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/groups/${id}/action`);
                }
                if (!stateUpdate || typeof stateUpdate !== "object") {
                    throw errors_1.HueApiError.invalidJson(`/api/${username}/groups/${id}/action`);
                }
                return handler.setGroupAction(hueReq, username, id, stateUpdate);
            }));
        }));
        // Empty collections (not implemented): groups, schedules, scenes, sensors, rules, resourcelinks
        for (const collection of [
            "groups",
            "schedules",
            "scenes",
            "sensors",
            "rules",
            "resourcelinks",
        ]) {
            fastify.get(`/api/:username/${collection}`, (request, reply) => __awaiter(this, void 0, void 0, function* () {
                yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                    const { username } = request.params;
                    const isAuth = yield handler.isUserAuthenticated(username);
                    if (!isAuth && !handler.isAuthDisabled()) {
                        throw errors_1.HueApiError.unauthorizedUser(`/api/${username}/${collection}`);
                    }
                    return {};
                }));
            }));
        }
        // Fallback for unhandled API routes
        fastify.all("/api/*", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            yield handleErrors(request, reply, () => __awaiter(this, void 0, void 0, function* () {
                const hueReq = toHueRequest(request);
                return handler.fallback(hueReq);
            }));
        }));
    });
}
