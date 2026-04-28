/**
 * Error handling middleware for Hue API responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { HueApiError } from "../../types/errors";

/**
 * Fastify error handler that converts errors to Hue API format
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
 * Create a Hue success response array
 */
export function createSuccessResponse(data: Record<string, unknown>): unknown[] {
  return [{ success: data }];
}
