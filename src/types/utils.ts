/**
 * Shared utility functions
 */

/**
 * Sanitize a string for use as ioBroker object ID segment.
 * Replaces everything except [A-Za-z0-9-_] with underscore.
 * See: adapter.FORBIDDEN_CHARS, ioBroker object ID requirements.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9\-_]/g, "_");
}
