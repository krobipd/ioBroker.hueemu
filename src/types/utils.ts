/**
 * Shared utility functions
 */

/**
 * Sanitize a string for use as ioBroker object ID segment.
 * Replaces everything except [A-Za-z0-9-_] with underscore.
 * See: adapter.FORBIDDEN_CHARS, ioBroker object ID requirements.
 *
 * @param id - Raw string to sanitize for use as object ID segment
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9\-_]/g, "_");
}

/**
 * Extract a log-friendly message from an unknown error value. Caller-side
 * guard against the `err instanceof Error ? err.message : String(err)`
 * pattern repeating across the codebase.
 *
 * @param err Value caught in a promise rejection / try/catch (may not be Error)
 */
export function errText(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (err === null) {
    return "null";
  }
  if (err === undefined) {
    return "undefined";
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}

/**
 * Collapse control characters (CR/LF/tab) in an untrusted string to single
 * spaces so client-supplied values (usernames, devicetypes) cannot forge extra
 * lines when interpolated into a log message.
 *
 * @param s - Raw, potentially attacker-controlled string to make log-safe
 */
export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]/g, " ");
}
