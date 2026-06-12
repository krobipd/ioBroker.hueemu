/**
 * Shared boundary coercion helpers.
 *
 * Anything crossing the API boundary (foreign-state values, Hue client
 * payloads, admin-config inputs) goes through these — runtime types from
 * outside our code are by definition unknown.
 */

// Strict decimal regex — only optional minus sign + digits + optional fractional
// part. Rejects HEX (`0x...`), exponential (`1e3`), trailing garbage (`12abc`,
// which `parseFloat` half-parsed to 12) and leading/trailing whitespace. Same
// hardening as hassemu (E8), homewizard (D8), beszel and parcelapp — fleet-wide
// consistency for the shared coerce-helper.
const DECIMAL_NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Coerce a value to a finite number. Accepts numbers directly and strict
 * decimal strings; rejects NaN, Infinity, HEX, exponential notation and
 * strings with trailing garbage. Returns null for anything else.
 *
 * @param v Value to coerce.
 */
export function coerceFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && DECIMAL_NUMBER_RE.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Coerce arbitrary values to a strict boolean.
 *
 * @param v - Value to coerce to boolean
 */
export function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") {
    return v;
  }
  if (typeof v === "number") {
    return v !== 0;
  }
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "on";
  }
  return false;
}

/**
 * Parse a 1-based light ID string (Hue API URL path) into a zero-based array
 * index. Returns null when the value is not a positive integer in `[1, max]`.
 * Caller translates `null` into a Hue `resourceNotAvailable` (404). Earlier
 * `parseInt("abc")` produced `NaN`, which silently passed the bound checks and
 * crashed later with a confusing TypeError.
 *
 * @param id - Light id from the URL path
 * @param max - Total number of items in the collection
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

/**
 * Parse a port number from an admin-config value (number or numeric string).
 * Returns undefined for missing / non-finite / unparseable input — the caller
 * decides whether a missing port is fatal.
 *
 * @param port - Raw value from `this.config.<portField>`.
 */
export function parsePort(port: unknown): number | undefined {
  if (typeof port === "number") {
    return Number.isFinite(port) ? port : undefined;
  }
  if (typeof port === "string" && port.trim().length > 0) {
    const n = parseInt(port.trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
