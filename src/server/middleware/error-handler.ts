/**
 * Error handling middleware for Hue API responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "../../types/config";
import { HueApiError } from "../../types/errors";

/**
 * The body-parser failures a real bridge answers with "body contains invalid json"
 * (type 2): a malformed, an empty, an oversized body, an unreadable media type or
 * length. v1.19.0 (audit 2026-09-25 Q6): only the first was recognised, the others
 * came back as "internal error" (901).
 */
const INVALID_BODY_CODES: ReadonlySet<string> = new Set([
  "FST_ERR_CTP_INVALID_JSON_BODY",
  "FST_ERR_CTP_EMPTY_JSON_BODY",
  "FST_ERR_CTP_BODY_TOO_LARGE",
  "FST_ERR_CTP_INVALID_MEDIA_TYPE",
  "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
]);

/**
 * True for a Fastify body-parse / schema-validation failure that should map to
 * the Hue "invalid JSON" error (type 2) rather than a generic internal error.
 * v1.10.0 (L4): covers both ajv schema validation (`.validation`) and the body
 * parser's failure codes (which carry no `.validation`, so the old
 * `.validation`-only check misrouted a malformed body to internal_error/901).
 *
 * @param error - Error thrown during request handling
 */
function isInvalidJsonError(error: FastifyError | HueApiError | Error): boolean {
  const code = (error as FastifyError).code;
  return (
    ("validation" in error && Boolean(error.validation)) || (typeof code === "string" && INVALID_BODY_CODES.has(code))
  );
}

/**
 * The address a Hue error names: the resource path below the user, the way the
 * bridge reports it (`/lights/1/state`, or `/` for the API root) — v1.19.0 (audit
 * 2026-09-25 Q8). It used to carry `/api/<username>` and the query string.
 *
 * @param url - The request URL
 */
export function hueAddress(url: string | undefined): string {
  const path = (url ?? "").split("?")[0];
  const below = path.replace(/^\/api(?:\/[^/]*)?/i, "");
  return below || "/";
}

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
  const address = hueAddress(request.url);

  if (error instanceof HueApiError) {
    // Return the Hue-formatted error
    reply.status(200).send([error.toResponse()]);
  } else if (isInvalidJsonError(error)) {
    // Fastify body-parse / validation error → Hue "invalid JSON" (type 2)
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
      error instanceof HueApiError ? String(error.type) : isInvalidJsonError(error) ? "invalid_json" : "internal_error";
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
