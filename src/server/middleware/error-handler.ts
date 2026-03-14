/**
 * Error handling middleware for Hue API responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { HueApiError } from '../../types/errors';

/**
 * Fastify error handler that converts errors to Hue API format
 */
export function hueErrorHandler(
    error: FastifyError | HueApiError | Error,
    request: FastifyRequest,
    reply: FastifyReply
): void {
    // Extract the path for the error response
    const address = request.url || '/';

    if (error instanceof HueApiError) {
        // Return the Hue-formatted error
        reply.status(200).send([ error.toResponse() ]);
    } else if ('validation' in error && error.validation) {
        // Fastify validation error - convert to Hue format
        const hueError = HueApiError.invalidJson(address);
        reply.status(200).send([ hueError.toResponse() ]);
    } else {
        // Generic error - wrap as internal error
        const hueError = HueApiError.internalError(error.message || 'Unknown error', address);
        reply.status(200).send([ hueError.toResponse() ]);
    }
}

/**
 * Create a Hue error response array
 */
export function createErrorResponse(error: HueApiError): unknown[] {
    return [ error.toResponse() ];
}

/**
 * Create a Hue success response array
 */
export function createSuccessResponse(data: Record<string, unknown>): unknown[] {
    return [ { success: data } ];
}

/**
 * Wrap an async handler to catch errors and convert them to Hue format
 * Preserves the request type for proper params access
 */
export function wrapHandler<TRequest extends FastifyRequest = FastifyRequest, T = unknown>(
    handler: (request: TRequest, reply: FastifyReply) => Promise<T>
): (request: TRequest, reply: FastifyReply) => Promise<void> {
    return async (request: TRequest, reply: FastifyReply): Promise<void> => {
        try {
            const result = await handler(request, reply);
            if (!reply.sent) {
                reply.send(result);
            }
        } catch (error) {
            if (error instanceof HueApiError) {
                reply.status(200).send([ error.toResponse() ]);
            } else if (error instanceof Error) {
                const hueError = HueApiError.internalError(error.message, request.url);
                reply.status(200).send([ hueError.toResponse() ]);
            } else {
                const hueError = HueApiError.internalError('Unknown error', request.url);
                reply.status(200).send([ hueError.toResponse() ]);
            }
        }
    };
}
