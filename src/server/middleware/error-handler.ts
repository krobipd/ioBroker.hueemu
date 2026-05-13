/**
 * Error handling middleware for Hue API responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../types/config";
import { HueApiError } from "../../types/errors";

/**
 * Fastify error handler that converts errors to Hue API format.
 *
 * No-log variant — used by tests + as backward-compat export. Production
 * code-path wires `createHueErrorHandler(logger)` to get debug-traces of
 * every converged error (I-Klasse, v1.4.5 Debug-Audit).
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
 * v1.4.5 (I): factory returning a Fastify error handler that adds a
 * `log.debug` line BEFORE the existing Hue-format conversion. Centralises
 * diagnostic visibility for every error that reaches the Fastify error
 * handler — Fastify validation errors, body-parse failures, anything not
 * caught by route-level `handleErrors`.
 *
 * @param logger Optional adapter logger; when omitted falls back to the
 *               no-log {@link hueErrorHandler} for backward compatibility.
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
 */
export function createSuccessResponse(data: Record<string, unknown>): unknown[] {
  return [{ success: data }];
}
