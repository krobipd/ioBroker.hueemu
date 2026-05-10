/**
 * Shared boundary coercion helpers.
 *
 * Anything crossing the API boundary (foreign-state values, Hue client
 * payloads, admin-config inputs) goes through these — runtime types from
 * outside our code are by definition unknown.
 */

/**
 * Coerce a value to a finite number. Accepts numbers and numeric strings.
 * Returns null for anything else.
 *
 * @param v Value to coerce.
 */
export function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse a 1-based light ID string (as it appears in Hue API URLs) into the
 * matching zero-based array index. Returns null when the value is not a
 * positive integer in `[1, max]`.
 *
 * Caller is expected to translate `null` into a Hue `resourceNotAvailable`
 * (404). Earlier `parseInt("abc")` produced `NaN` which silently passed
 * `index < 0` and `index >= length` checks, accessed `devices[NaN]`, and
 * crashed several lines later with a confusing TypeError.
 *
 * @param id Light id from the URL path (typically `req.params.id`).
 * @param max Total number of items in the bound collection.
 */
export function parseLightIndex(id: unknown, max: number): number | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (!/^\d+$/.test(id)) {
    return null;
  }
  const n = parseInt(id, 10);
  if (!Number.isFinite(n) || n < 1 || n > max) {
    return null;
  }
  return n - 1;
}
