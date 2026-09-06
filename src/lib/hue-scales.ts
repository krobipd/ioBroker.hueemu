/**
 * Everything hueemu knows about Hue value scales, in one place.
 *
 * Three things used to live in three different files: the Hue ranges and both
 * conversion directions sat inside `DeviceBindingService` (which is a state
 * cache and a light builder, not a unit library), the derivation from a source
 * object's `common` sat in `device-scan.ts` (which is a detector adapter), and
 * the relative-attribute arithmetic sat next to the write path. They are the
 * same subject: how a foreign state's number relates to Hue's number.
 *
 * Pure — every function here takes what it needs and returns a value. The only
 * side effect is the debug line a caller-supplied logger writes when a value
 * cannot be used.
 */

import type { Logger } from "../types/config";
import { coerceBool, coerceFiniteNumber } from "./coerce";

/* -------------------------------------------------------------------------- */
/* Hue API ranges (per Philips Hue API specification)                          */
/* -------------------------------------------------------------------------- */

/** Lowest brightness the Hue API knows — 0 is not a brightness, it is "off". */
export const HUE_BRI_MIN = 1;
/** Highest brightness the Hue API knows. */
export const HUE_BRI_MAX = 254;
/** Highest hue value — the colour wheel has 65536 positions, 0..65535. */
export const HUE_HUE_MAX = 65535;
/** Highest saturation the Hue API knows. */
export const HUE_SAT_MAX = 254;
/** Warmest colour temperature in mired. */
export const HUE_CT_MAX = 500;
/** Coldest colour temperature in mired. */
export const HUE_CT_MIN = 153;
/** What an unmapped colour temperature reports. */
export const HUE_CT_DEFAULT = 250;
/** What an unmapped xy reports — the white point. */
export const HUE_XY_DEFAULT: [number, number] = [0.5, 0.5];
/** Number of distinct hue values — the wrap modulus for the colour wheel. */
const HUE_HUE_SPAN = HUE_HUE_MAX + 1;

/* -------------------------------------------------------------------------- */
/* Scale kinds                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * v1.4.4 (D3): scale of the foreign source state. Earlier the read path
 * heuristically picked between 0..1 and 0..100 by the value itself
 * (`if (n <= 1) ×254 else if (n <= 100) ÷100×254`) — ambiguous at the
 * boundary: a `level.dimmer` storing 1 (= 1 %) collapsed to bri 254
 * (full bright). Now the scale is derived from the bound object, and the user
 * can override it per device per state.
 *
 * `auto` = derive from the object; fall back to the legacy heuristic when the
 * object proves nothing (v1.17.0 — before that `auto` was the heuristic and
 * nothing else, in the read direction only).
 * `percent` = 0..100 ↔ 1..254
 * `normalized` = 0..1 ↔ 1..254
 * `raw` = 1..254 (Hue native), value passed through with clamp
 */
export type LightStateScale = "auto" | "percent" | "normalized" | "raw";
/** Scale for the hue source state: 'raw' = 0..65535 (Hue native), 'degrees' = 0..360. */
export type HueScale = "raw" | "degrees";
/** Scale for the ct source state: 'raw' = 153..500 mired (Hue native), 'kelvin' = Kelvin. */
export type CtScale = "raw" | "kelvin";

/**
 * What the conversion needs to know about a device: its scales, and its name for
 * the diagnostic line. Deliberately narrower than `DeviceConfig` — the unit
 * conversion has no business seeing state ids or light types.
 */
export interface ScaledDevice {
  /** Display name — only used in log lines. */
  name?: string;
  /** Scale of the brightness source state. */
  briScale?: LightStateScale;
  /** Scale of the saturation source state. */
  satScale?: LightStateScale;
  /** Scale of the hue source state. */
  hueScale?: HueScale;
  /** Scale of the colour-temperature source state. */
  ctScale?: CtScale;
}

/**
 * True when a scale field carries no decision — absent, empty, or the explicit
 * `auto`. All three mean the same thing since v1.17.0: derive it if the bound
 * object proves something.
 *
 * Before v1.17.0 only the ABSENT form was treated this way, so a device the
 * device-manager form had written (its select preselected `auto`) was excluded
 * from the derivation for good.
 *
 * @param scale The stored scale field.
 */
export function isUndecidedScale(scale: string | undefined): boolean {
  return scale === undefined || scale === "" || scale === "auto";
}

/* -------------------------------------------------------------------------- */
/* Deriving a scale from the bound object                                      */
/* -------------------------------------------------------------------------- */

/**
 * What the mapping needs to know about a candidate target state. Read from the
 * real ioBroker object, never guessed from a detector's pattern names.
 */
export interface StateFacts {
  /** `false` only when `common.write` is explicitly false (a status mirror). */
  writable: boolean;
  /** `common.min`, when the source declares one. */
  min?: number;
  /** `common.max`, when the source declares one. */
  max?: number;
  /** `common.unit`, when the source declares one. */
  unit?: string;
}

/** Resolve the facts of a state id, or `undefined` when the object is unknown. */
export type StateLookup = (id: string) => StateFacts | undefined;

/**
 * Read the facts hueemu needs from a state object. A non-state object (or a
 * missing one) yields `undefined`, which every caller treats as "not usable".
 *
 * @param obj The object from the object database, if present.
 */
export function stateFactsOf(obj: ioBroker.Object | null | undefined): StateFacts | undefined {
  if (obj?.type !== "state") {
    return undefined;
  }
  const common = obj.common;
  return {
    // Only an explicit `false` disqualifies: plenty of adapters omit the flag on
    // states that are perfectly writable.
    writable: common.write !== false,
    min: typeof common.min === "number" ? common.min : undefined,
    max: typeof common.max === "number" ? common.max : undefined,
    unit: typeof common.unit === "string" ? common.unit : undefined,
  };
}

/** Tolerance for matching a declared max against a well-known scale bound. */
const MAX_MATCH_TOLERANCE = 0.5;

/**
 * True when a declared bound is (near enough) an expected value. `common.max`
 * is sometimes a float a hair off the round number (HomeMatic stores 1.01 for a
 * 0..100 level in its own native block).
 *
 * @param actual The declared bound, if any.
 * @param expected The bound we are testing for.
 */
function isAbout(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= MAX_MATCH_TOLERANCE;
}

/**
 * Normalise a unit string for comparison: trimmed and lower-cased. The degree
 * sign is deliberately KEPT — a bare `"°"` is the unit of a hue in degrees,
 * so stripping it would erase the very evidence we are looking for.
 *
 * @param unit The raw `common.unit`, if any.
 */
function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "").trim().toLowerCase();
}

/** Units that mean "degrees on a colour wheel". */
const DEGREE_UNITS: ReadonlySet<string> = new Set(["°", "deg", "deg.", "degree", "degrees", "grad"]);

/** Units that mean "Kelvin" — adapters write it with and without the degree sign. */
const KELVIN_UNITS: ReadonlySet<string> = new Set(["k", "°k", "kelvin"]);

/** Units that mean "mired", the Hue-native colour-temperature unit. */
const MIRED_UNITS: ReadonlySet<string> = new Set(["mired", "mireds", "mirek", "mk^-1"]);

/**
 * Derive the scale of a percent-style source (brightness, saturation).
 *
 * Evidence order is deliberate and narrow: **only `common.min`/`common.max` and
 * `common.unit` count**. The role is NEVER evidence — the 2026-09-03 audit
 * measured a live zigbee `level.color.temperature` that carries no unit and no
 * bounds while the detector's pattern claims `°K`; deriving from the role would
 * have turned a correct binding into a wrong one. No evidence → `undefined`,
 * i.e. the field stays undecided and the heuristic applies.
 *
 * @param facts Facts of the bound source state, if known.
 */
export function deriveLevelScale(facts: StateFacts | undefined): LightStateScale | undefined {
  if (!facts) {
    return undefined;
  }
  if (normalizeUnit(facts.unit) === "%") {
    return "percent";
  }
  if (isAbout(facts.max, 100)) {
    return "percent";
  }
  if (isAbout(facts.max, 1)) {
    return "normalized";
  }
  if (isAbout(facts.max, 254) || isAbout(facts.max, 255)) {
    return "raw";
  }
  return undefined;
}

/**
 * Derive the scale of a hue source: `degrees` for a 0..360 colour wheel,
 * `raw` for a Hue-native 0..65535 source. Same evidence rules as
 * {@link deriveLevelScale}.
 *
 * @param facts Facts of the bound source state, if known.
 */
export function deriveHueScale(facts: StateFacts | undefined): HueScale | undefined {
  if (!facts) {
    return undefined;
  }
  if (DEGREE_UNITS.has(normalizeUnit(facts.unit))) {
    return "degrees";
  }
  if (isAbout(facts.max, 360)) {
    return "degrees";
  }
  if (isAbout(facts.max, 65535) || isAbout(facts.max, 65534)) {
    return "raw";
  }
  return undefined;
}

/** Lowest `common.max` that can only sensibly be a Kelvin colour temperature. */
const KELVIN_MIN_PLAUSIBLE_MAX = 1000;

/**
 * Derive the scale of a colour-temperature source: `kelvin` vs. Hue-native
 * mired. Same evidence rules as {@link deriveLevelScale} — and this is exactly
 * the state where guessing from the role would break the zigbee adapter, which
 * reports mired with neither unit nor bounds.
 *
 * @param facts Facts of the bound source state, if known.
 */
export function deriveCtScale(facts: StateFacts | undefined): CtScale | undefined {
  if (!facts) {
    return undefined;
  }
  const unit = normalizeUnit(facts.unit);
  if (KELVIN_UNITS.has(unit)) {
    return "kelvin";
  }
  if (MIRED_UNITS.has(unit)) {
    return "raw";
  }
  if (facts.max !== undefined && facts.max >= KELVIN_MIN_PLAUSIBLE_MAX) {
    return "kelvin";
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Scalar helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Clamp a finite number into an integer range.
 *
 * @param v Finite input number
 * @param min Minimum (inclusive)
 * @param max Maximum (inclusive)
 */
export function clampRound(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * Wrap a hue value into 0..65535. Unlike brightness, hue has no ends: one step
 * past red comes out at the other side of the wheel.
 *
 * @param value Raw (possibly out-of-range) hue value
 */
export function wrapHue(value: number): number {
  return ((Math.round(value) % HUE_HUE_SPAN) + HUE_HUE_SPAN) % HUE_HUE_SPAN;
}

/**
 * Round an xy component and hold it inside the valid 0..1 colour space.
 *
 * @param v The shifted component, possibly outside the colour space
 */
export function clampXyComponent(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));
}

/**
 * v1.10.0 (I2): scale a hue source value into the Hue 0..65535 range.
 * 'degrees' maps 0..360 → 0..65535; 'raw' (default) is already Hue-native.
 *
 * @param n Raw finite source value
 * @param scale Per-device hue scale ('raw' | 'degrees')
 */
export function hueFromState(n: number, scale: HueScale | undefined): number {
  const hueValue = scale === "degrees" ? (n / 360) * HUE_HUE_MAX : n;
  return clampRound(hueValue, 0, HUE_HUE_MAX);
}

/**
 * Inverse of {@link hueFromState}: a Hue 0..65535 value back into the source scale.
 *
 * @param n Incoming Hue value (0..65535 from the client)
 * @param scale Per-device hue scale ('raw' | 'degrees')
 */
export function hueForState(n: number, scale: HueScale | undefined): number {
  const hueValue = clampRound(n, 0, HUE_HUE_MAX);
  return scale === "degrees" ? Math.round((hueValue / HUE_HUE_MAX) * 360) : hueValue;
}

/**
 * v1.10.0 (I2): scale a colour-temperature source value into Hue mired (153..500).
 * 'kelvin' maps Kelvin → mired (1e6/K); 'raw' (default) is already Hue-native mired.
 *
 * @param n Raw finite source value
 * @param scale Per-device ct scale ('raw' | 'kelvin')
 */
export function ctFromState(n: number, scale: CtScale | undefined): number {
  if (scale === "kelvin") {
    return n > 0 ? clampRound(1_000_000 / n, HUE_CT_MIN, HUE_CT_MAX) : HUE_CT_DEFAULT;
  }
  return clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
}

/**
 * Inverse of {@link ctFromState}: a Hue mired (153..500) value back into the source scale.
 *
 * @param n Incoming Hue mired value (153..500 from the client)
 * @param scale Per-device ct scale ('raw' | 'kelvin')
 */
export function ctForState(n: number, scale: CtScale | undefined): number {
  const mired = clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
  return scale === "kelvin" ? Math.round(1_000_000 / mired) : mired;
}

/* -------------------------------------------------------------------------- */
/* Percent-style scales, both directions                                       */
/* -------------------------------------------------------------------------- */

/**
 * The legacy value heuristic, used only where the bound object proved nothing.
 * `<=1` is read as 0..1, `<=100` as a percentage, anything above as Hue-native.
 *
 * @param n The finite source value
 * @param min Minimum Hue API value (inclusive)
 * @param max Maximum Hue API value (inclusive)
 * @returns the Hue value and the branch name, for the diagnostic line
 */
function heuristicFromState(n: number, min: number, max: number): { value: number; branch: string } {
  if (n <= 1) {
    return { value: clampRound(n * max, min, max), branch: "le1" };
  }
  if (n <= 100) {
    return { value: clampRound((n / 100) * max, min, max), branch: "le100" };
  }
  return { value: clampRound(n, min, max), branch: "raw" };
}

/**
 * v1.4.4 (D3): coerce a foreign-state value into the Hue API integer range
 * (`min..max`) according to the configured scale.
 *
 * - `percent` — input is 0..100, mapped to `min..max`.
 * - `normalized` — input is 0..1, mapped to 0..max.
 * - `raw` — input is already in `min..max` (Hue native), clamped + rounded.
 * - undecided (`auto`/empty) — the legacy heuristic, which is all that is left
 *   once the bound object proved nothing.
 *
 * `null` / non-finite input always returns `max` (the documented default).
 *
 * @param value Raw value from the foreign state
 * @param scale Configured scale mode
 * @param min Minimum Hue API value (inclusive)
 * @param max Maximum Hue API value (inclusive)
 * @param logger Logger for the diagnostic lines
 * @param deviceName Device name for the diagnostic line
 * @param stateName State name for the diagnostic line
 */
export function scaleValueFromState(
  value: unknown,
  scale: LightStateScale | undefined,
  min: number,
  max: number,
  logger: Logger,
  deviceName?: string,
  stateName?: string,
): number {
  const n = coerceFiniteNumber(value);
  if (n === null) {
    logger.debug(`Default fallback for ${stateName ?? "?"} (device="${deviceName}"): raw=${JSON.stringify(value)}`);
    return max;
  }
  switch (scale) {
    case "percent":
      return clampRound((n / 100) * max, min, max);
    case "normalized":
      return clampRound(n * max, min, max);
    case "raw":
      return clampRound(n, min, max);
    default: {
      const { value: result, branch } = heuristicFromState(n, min, max);
      logger.debug(`scale-auto[${deviceName ?? "?"}/${stateName ?? "?"}/${branch}]: n=${n} → ${result}`);
      return result;
    }
  }
}

/**
 * Inverse of {@link scaleValueFromState} — a Hue value (1..254) back into the
 * configured foreign-state scale on write.
 *
 * **The undecided case is the reason v1.17.0 resolves scales at start.** Before
 * that, `auto` meant "guess" when reading and "write the raw Hue number" when
 * writing, so a client setting bri 127 put 127 into a 0..100 % datapoint — the
 * read side hid it, because its third branch reads 127 back as 127. The two
 * directions have to agree, so the heuristic is inverted here as well: a source
 * that reads as a percentage is written as a percentage.
 *
 * @param hueValue Hue-native value (1..254)
 * @param scale Configured scale mode for the foreign state
 * @param max Maximum Hue API value
 * @param lastSourceValue The value the source state last held, when known — the
 *   only evidence an undecided scale has left about what the source expects
 */
export function scaleValueForState(
  hueValue: number,
  scale: LightStateScale | undefined,
  max: number,
  lastSourceValue?: unknown,
): number {
  switch (scale) {
    case "percent":
      // Round to one decimal so 254/254 → 100, 127/254 → 50.0
      return Math.round((hueValue / max) * 100 * 10) / 10;
    case "normalized":
      return Math.round((hueValue / max) * 1000) / 1000;
    case "raw":
      return hueValue;
    default:
      return invertHeuristicForState(hueValue, max, lastSourceValue);
  }
}

/**
 * Write side of the legacy heuristic: mirror whatever branch the read side takes
 * for this source, so a round trip lands where it started.
 *
 * The source's own last value is the evidence: a state that reads 0..1 is
 * written 0..1, one that reads 0..100 is written as a percentage, and one that
 * already holds Hue-native numbers is written unscaled. With no value at all
 * (nothing read yet), Hue-native is the historical behaviour and stays.
 *
 * `0` is deliberately NOT read as "the 0..1 branch": every scale has a zero, and
 * a dimmer that happens to be off must not turn the next write into 0..1.
 *
 * @param hueValue Hue-native value (1..254)
 * @param max Maximum Hue API value
 * @param lastSourceValue The value the source state last held, when known
 */
function invertHeuristicForState(hueValue: number, max: number, lastSourceValue: unknown): number {
  const last = coerceFiniteNumber(lastSourceValue);
  if (last === null || last === 0 || last > 100) {
    return hueValue;
  }
  if (last <= 1) {
    return Math.round((hueValue / max) * 1000) / 1000;
  }
  return Math.round((hueValue / max) * 100 * 10) / 10;
}

/**
 * Write-path helper for bri/sat: coerce + clamp the incoming Hue value into
 * [min,max], then scale it back into the configured foreign-state scale.
 * Null/non-finite input is not written at all (undefined → the caller skips the
 * write and still acks, like the xy path) — a default the client never asked
 * for must not land in the foreign state.
 *
 * @param value Raw value from the Hue API
 * @param min Minimum Hue API value (inclusive)
 * @param max Maximum Hue API value (inclusive)
 * @param scale Configured scale mode for the foreign state
 * @param logger Logger for the diagnostic line
 * @param deviceName Device name for the diagnostic line
 * @param stateName State name for the diagnostic line
 * @param lastSourceValue The value the source state last held, when known
 */
export function clampScaleForState(
  value: unknown,
  min: number,
  max: number,
  scale: LightStateScale | undefined,
  logger: Logger,
  deviceName?: string,
  stateName?: string,
  lastSourceValue?: unknown,
): number | undefined {
  const n = coerceFiniteNumber(value);
  if (n === null) {
    logger.debug(`Ignoring invalid ${stateName ?? "?"} write (device="${deviceName}"): raw=${JSON.stringify(value)}`);
    return undefined;
  }
  return scaleValueForState(clampRound(n, min, max), scale, max, lastSourceValue);
}

/* -------------------------------------------------------------------------- */
/* Attribute conversion, both directions                                       */
/* -------------------------------------------------------------------------- */

/**
 * Get the default value the Hue API reports for an unmapped state.
 *
 * @param stateName Hue state name
 */
export function getDefaultValue(stateName: string): unknown {
  switch (stateName) {
    case "on":
      return false;
    case "bri":
      return HUE_BRI_MAX;
    case "hue":
      return 0;
    case "sat":
      return HUE_SAT_MAX;
    case "ct":
      return HUE_CT_DEFAULT;
    case "xy":
      return HUE_XY_DEFAULT;
    default:
      return null;
  }
}

/**
 * Parse an xy value that may arrive as an array, as our own JSON round-trip
 * (`"[0.3,0.4]"`) or as a plain CSV (`"0.3, 0.4"`).
 *
 * @param value The raw source value
 * @returns the coordinate pair, or undefined when it is not one
 */
function parseXy(value: unknown): [number, number] | undefined {
  if (Array.isArray(value) && value.length >= 2) {
    const x = coerceFiniteNumber(value[0]);
    const y = coerceFiniteNumber(value[1]);
    if (x !== null && y !== null) {
      return [x, y];
    }
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    // v1.4.3 (D4): we serialize xy as a JSON string on writes (`"[0.3,0.4]"`),
    // so reads must accept the round-trip too. Without this, the comma-split
    // below produced `["[0.3","0.4]"]`, and every read fell through to the
    // [0.5, 0.5] default — losing whatever the client just set.
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length >= 2) {
        const x = coerceFiniteNumber(parsed[0]);
        const y = coerceFiniteNumber(parsed[1]);
        if (x !== null && y !== null) {
          return [x, y];
        }
      }
    } catch {
      /* fall through to CSV */
    }
  }
  const parts = trimmed.split(",");
  if (parts.length >= 2) {
    // v1.10.0 (L7): trim each part — coerceFiniteNumber is strict (rejects
    // surrounding whitespace), so a spaced CSV like "0.3, 0.4" would otherwise
    // fall through to the [0.5, 0.5] white default.
    const x = coerceFiniteNumber(parts[0].trim());
    const y = coerceFiniteNumber(parts[1].trim());
    if (x !== null && y !== null) {
      return [x, y];
    }
  }
  return undefined;
}

/**
 * Convert a value from an ioBroker state into the Hue API's shape and range.
 *
 * @param stateName Hue API state key (`on`, `bri`, `hue`, `sat`, `ct`, `xy`)
 * @param value Raw value from the foreign state
 * @param device The device's scales (and name, for the log)
 * @param logger Logger for the diagnostic lines
 */
export function convertValueFromState(
  stateName: string,
  value: unknown,
  device: ScaledDevice | undefined,
  logger: Logger,
): unknown {
  if (value === null || value === undefined) {
    return getDefaultValue(stateName);
  }

  switch (stateName) {
    case "on":
      // v1.10.0 (M1): shared boundary bool coercion (allowlist true/1/yes/on,
      // case-insensitive) — the same helper main.ts uses for disableAuth. Reads
      // "off"/"no"/"disabled"/"FALSE" as off, unlike the old "false"/"0"/""
      // blocklist (which let every other string, incl. "off", read as ON) or a
      // bare Boolean() cast (Boolean("false") === true).
      return coerceBool(value);
    case "bri":
      return scaleValueFromState(value, device?.briScale, HUE_BRI_MIN, HUE_BRI_MAX, logger, device?.name, "bri");
    case "sat":
      return scaleValueFromState(value, device?.satScale, 0, HUE_SAT_MAX, logger, device?.name, "sat");
    case "hue": {
      const n = coerceFiniteNumber(value);
      if (n === null) {
        logger.debug(`Default fallback for hue (device="${device?.name}"): raw=${JSON.stringify(value)}`);
        return 0;
      }
      return hueFromState(n, device?.hueScale);
    }
    case "ct": {
      const n = coerceFiniteNumber(value);
      if (n === null) {
        logger.debug(`Default fallback for ct (device="${device?.name}"): raw=${JSON.stringify(value)}`);
        return HUE_CT_DEFAULT;
      }
      return ctFromState(n, device?.ctScale);
    }
    case "xy": {
      const xy = parseXy(value);
      if (xy) {
        return xy;
      }
      logger.debug(`Default fallback for xy (device="${device?.name}"): raw=${JSON.stringify(value)} not parsable`);
      return HUE_XY_DEFAULT;
    }
    default:
      return value;
  }
}

/**
 * Convert a value from the Hue API into what the ioBroker state expects.
 * Returns `undefined` when the payload is unusable — the caller then skips the
 * write instead of poisoning the foreign state with a default.
 *
 * @param stateName Hue state name (on, bri, ct, etc.)
 * @param value Value from the Hue API
 * @param device The device's scales (and name, for the log)
 * @param logger Logger for the diagnostic lines
 * @param lastSourceValue The value the source state last held, when known
 */
export function convertValueForState(
  stateName: string,
  value: unknown,
  device: ScaledDevice | undefined,
  logger: Logger,
  lastSourceValue?: unknown,
): ioBroker.StateValue | undefined {
  switch (stateName) {
    case "on":
      // v1.10.0 (M1): symmetric with the read path — shared coerceBool
      // (allowlist true/1/yes/on). Hue clients send JSON booleans; a malformed
      // string body ("off", "no", …) must not flip a light on.
      return coerceBool(value);
    case "bri":
      return clampScaleForState(
        value,
        HUE_BRI_MIN,
        HUE_BRI_MAX,
        device?.briScale,
        logger,
        device?.name,
        "bri",
        lastSourceValue,
      );
    case "sat":
      return clampScaleForState(value, 0, HUE_SAT_MAX, device?.satScale, logger, device?.name, "sat", lastSourceValue);
    case "hue": {
      const n = coerceFiniteNumber(value);
      if (n === null) {
        logger.debug(`Ignoring invalid hue write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
        return undefined;
      }
      return hueForState(n, device?.hueScale);
    }
    case "ct": {
      const n = coerceFiniteNumber(value);
      if (n === null) {
        logger.debug(`Ignoring invalid ct write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
        return undefined;
      }
      return ctForState(n, device?.ctScale);
    }
    case "xy": {
      // Only a 2-element finite-number array (or its JSON round-trip) is a valid
      // xy. Anything else (object, bare number) would serialize to junk like
      // "[object Object]".
      if (Array.isArray(value) && value.length >= 2) {
        const x = coerceFiniteNumber(value[0]);
        const y = coerceFiniteNumber(value[1]);
        if (x !== null && y !== null) {
          return JSON.stringify([x, y]);
        }
      }
      logger.debug(`Ignoring invalid xy write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
      return undefined;
    }
    default:
      if (value !== null && typeof value === "object") {
        return JSON.stringify(value);
      }
      return value as ioBroker.StateValue;
  }
}

/* -------------------------------------------------------------------------- */
/* Relative attributes                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Hue v1 relative attributes: `<base>_inc` adjusts the CURRENT value instead of
 * setting an absolute one. That is how "make it a bit darker" and a dimmer
 * rocker work — the client does not know the current value and must not need to.
 *
 * Semantics verified against the official parameter description and the diyHue
 * reference bridge (`HueObjects/__init__.py:incProcess`, ebd0eaf):
 *  - the `_inc` field is IGNORED when its absolute field is in the same body,
 *  - the result is clamped, EXCEPT hue, which wraps (a colour wheel has no end),
 *  - the response carries the ABSOLUTE address with the resulting value.
 *
 * Deviations, both deliberate: every `_inc` in a body is honoured (diyHue takes
 * only the first), and hue wraps modulo 65536 rather than diyHue's ±65535 —
 * 0..65535 inclusive is 65536 distinct values.
 */
export const INCREMENT_ATTRIBUTES: Readonly<Record<string, string>> = {
  bri_inc: "bri",
  sat_inc: "sat",
  hue_inc: "hue",
  ct_inc: "ct",
  xy_inc: "xy",
};

/**
 * Apply a relative change to the current Hue-space value of one attribute.
 * Returns `undefined` when either side is not a usable value — the caller then
 * leaves the request untouched rather than inventing a target.
 *
 * @param base Absolute attribute name the increment belongs to (bri/sat/hue/ct/xy)
 * @param current Current Hue-space value of that attribute
 * @param delta The client-supplied increment
 */
export function applyIncrement(base: string, current: unknown, delta: unknown): number | [number, number] | undefined {
  if (base === "xy") {
    if (!Array.isArray(delta) || delta.length < 2 || !Array.isArray(current) || current.length < 2) {
      return undefined;
    }
    const dx = coerceFiniteNumber(delta[0]);
    const dy = coerceFiniteNumber(delta[1]);
    const x = coerceFiniteNumber(current[0]);
    const y = coerceFiniteNumber(current[1]);
    if (dx === null || dy === null || x === null || y === null) {
      return undefined;
    }
    return [clampXyComponent(x + dx), clampXyComponent(y + dy)];
  }

  const step = coerceFiniteNumber(delta);
  const now = coerceFiniteNumber(current);
  if (step === null || now === null) {
    return undefined;
  }
  switch (base) {
    case "bri":
      return clampRound(now + step, HUE_BRI_MIN, HUE_BRI_MAX);
    case "sat":
      return clampRound(now + step, 0, HUE_SAT_MAX);
    case "ct":
      return clampRound(now + step, HUE_CT_MIN, HUE_CT_MAX);
    case "hue":
      return wrapHue(now + step);
    default:
      return undefined;
  }
}
