/**
 * Error handling middleware for Hue API responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../types/config";
import { HueApiError } from "../../types/errors";

/**
 * Fastify error handler that converts errors to Hue API format (no logging).
 *
 * @param error - Error thrown during request handling
 * @param request - Fastify request object
 * @param reply - Fastify reply object
 */
export function hueErrorHandler(
  error: FastifyError | HueApiError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Extract the path for the error response
  const address = request.url || "/";

  if (error instanceof HueApiError) {
    // Return the Hue-formatted error
    reply.status(200).send([error.toResponse()]);
  } else if ("validation" in error && error.validation) {
    // Fastify validation error - convert to Hue format
    const hueError = HueApiError.invalidJson(address);
    reply.status(200).send([hueError.toResponse()]);
  } else {
    // Generic error - wrap as internal error
    const hueError = HueApiError.internalError(error.message || "Unknown error", address);
    reply.status(200).send([hueError.toResponse()]);
  }
}

/**
 * Factory returning a Fastify error handler with debug logging.
 *
 * @param logger - Optional logger for debug output
 */
export function createHueErrorHandler(
  logger?: Logger,
): (error: FastifyError | HueApiError | Error, request: FastifyRequest, reply: FastifyReply) => void {
  if (!logger) {
    return hueErrorHandler;
  }
  return function loggedHueErrorHandler(error, request, reply): void {
    const errorType =
      error instanceof HueApiError
        ? String(error.type)
        : "validation" in error && error.validation
          ? "invalid_json"
          : "internal_error";
    const message = error.message || "Unknown error";
    logger.debug(`Hue error-handler: ${request.method} ${request.url} → ${errorType} (${message})`);
    hueErrorHandler(error, request, reply);
  };
}

/**
 * Create a Hue success response array
 *
 * @param data - Key-value pairs for the success response
 */
export function createSuccessResponse(data: Record<string, unknown>): unknown[] {
  return [{ success: data }];
}
