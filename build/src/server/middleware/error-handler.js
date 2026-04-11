"use strict";
/**
 * Error handling middleware for Hue API responses
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hueErrorHandler = hueErrorHandler;
exports.createSuccessResponse = createSuccessResponse;
const errors_1 = require("../../types/errors");
/**
 * Fastify error handler that converts errors to Hue API format
 */
function hueErrorHandler(error, request, reply) {
    // Extract the path for the error response
    const address = request.url || "/";
    if (error instanceof errors_1.HueApiError) {
        // Return the Hue-formatted error
        reply.status(200).send([error.toResponse()]);
    }
    else if ("validation" in error && error.validation) {
        // Fastify validation error - convert to Hue format
        const hueError = errors_1.HueApiError.invalidJson(address);
        reply.status(200).send([hueError.toResponse()]);
    }
    else {
        // Generic error - wrap as internal error
        const hueError = errors_1.HueApiError.internalError(error.message || "Unknown error", address);
        reply.status(200).send([hueError.toResponse()]);
    }
}
/**
 * Create a Hue success response array
 */
function createSuccessResponse(data) {
    return [{ success: data }];
}
//# sourceMappingURL=error-handler.js.map