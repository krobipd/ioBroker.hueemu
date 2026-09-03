/**
 * v1.11.0: Light-device discovery. Runs ioBroker's ChannelDetector over the
 * object tree and maps each detected light control to a hueemu DeviceConfig
 * suggestion. Pure + adapter-agnostic so it is fully unit-testable; the
 * DeviceManagement backend feeds it the object map and persists the results.
 *
 * Mapping verified empirically against `@iobroker/type-detector`'s real detect()
 * output (see the scan test): light→onoff, dimmer→dimmable, ct→ct, hue→color,
 * cie→color(xy). RGB-channel controls (rgb/rgbSingle/rgbwSingle) carry
 * RED/GREEN/BLUE, which hueemu's hue/sat/xy model has no slot for — those are
 * reported as unmapped rather than silently dropped.
 *
 * v1.15.0 — three defects the 2026-09-03 audit proved on real objects:
 *   1. The suggestion carried NO value scale, so a source in degrees/percent was
 *      read and written as if it were Hue-native. See {@link deriveScales}.
 *   2. The on/off fallback accepted `ON_ACTUAL`, which every detector light
 *      pattern defines as `write: false` — a status mirror, not a switch. Every
 *      candidate is now checked for writability on the real object.
 *   3. Controls without a switch state were dropped silently and counted
 *      nowhere. They are now either mapped brightness-only (a HomeMatic
 *      HmIP-BDT dimmer channel has LEVEL and no boolean state at all) or
 *      reported with a reason.
 */

import ChannelDetector, { Types } from "@iobroker/type-detector";
import type { CtScale, DeviceConfig, HueScale, LightStateScale } from "../hue-api";

/** Minimal shape of a detected state — only the fields the mapping consumes. */
interface DetectedState {
  name: string;
  id?: string;
}

/**
 * What the mapping needs to know about a candidate target state. Read from the
 * real ioBroker object, never guessed from the detector's pattern names.
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

/** Why a detected light control has no hueemu representation. */
export type UnmappedReason =
  /** An RGB-channel control (RED/GREEN/BLUE) — hueemu's model has no slot. */
  | "rgbChannel"
  /** Nothing writable to drive: neither a switch nor a brightness/value state. */
  | "noWritableTarget";

/** A light control the detector found but hueemu cannot map. */
export interface UnmappedControl {
  /** The device/channel id the control was detected on. */
  id: string;
  /** The detector type (e.g. "rgb"). */
  type: string;
  /** Why it could not be mapped — drives the message the user sees. */
  reason: UnmappedReason;
}

/** The outcome of a scan: mappable device suggestions plus controls with no hueemu slot. */
export interface ScanResult {
  /** Ready-to-add device suggestions. */
  devices: DeviceConfig[];
  /** Detected light controls with no hueemu equivalent (surfaced, not dropped). */
  unmapped: UnmappedControl[];
}

/**
 * Index a control's detected states by their pattern name for quick lookup.
 *
 * @param states The control's detected states.
 * @returns Map of pattern name → state id (first occurrence wins).
 */
function statesByName(states: DetectedState[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of states) {
    if (s.id) {
      // First occurrence wins — the primary state for a role is listed first.
      if (!map.has(s.name)) {
        map.set(s.name, s.id);
      }
    }
  }
  return map;
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
 * i.e. the field stays empty and the existing `auto` default applies.
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

/**
 * Attach every scale we can prove to a suggestion. Fields with no evidence are
 * left absent so the adapter keeps its documented defaults.
 *
 * @param device The suggestion built from the detected state ids.
 * @param lookup Resolves a state id to its facts.
 */
function deriveScales(device: DeviceConfig, lookup: StateLookup): DeviceConfig {
  const briScale = device.briState ? deriveLevelScale(lookup(device.briState)) : undefined;
  const satScale = device.satState ? deriveLevelScale(lookup(device.satState)) : undefined;
  const hueScale = device.hueState ? deriveHueScale(lookup(device.hueState)) : undefined;
  const ctScale = device.ctState ? deriveCtScale(lookup(device.ctState)) : undefined;
  return {
    ...device,
    ...(briScale ? { briScale } : {}),
    ...(satScale ? { satScale } : {}),
    ...(hueScale ? { hueScale } : {}),
    ...(ctScale ? { ctScale } : {}),
  };
}

/** The result of mapping one detected control. */
export type MapOutcome = { kind: "device"; device: DeviceConfig } | { kind: "unmapped"; reason: UnmappedReason };

/**
 * Pick the first candidate that resolves to a WRITABLE state. `ON_ACTUAL` is
 * `write: false` in every light pattern of the detector, so a status mirror can
 * never end up as the switch this way — and an unknown object (no facts) is not
 * accepted either, because we cannot tell whether writing to it does anything.
 *
 * @param by Detected states indexed by pattern name.
 * @param names Candidate pattern names, best first.
 * @param lookup Resolves a state id to its facts.
 */
function firstWritable(by: Map<string, string>, names: readonly string[], lookup: StateLookup): string | undefined {
  for (const name of names) {
    const id = by.get(name);
    if (id && lookup(id)?.writable) {
      return id;
    }
  }
  return undefined;
}

/**
 * Map one detected control to a hueemu DeviceConfig, or report why it has no
 * hueemu representation.
 *
 * A control is mappable as soon as SOMETHING writable can drive it: a switch, or
 * — failing that — a brightness/value state (brightness then carries on/off, see
 * `DeviceBindingService`). Only when neither exists is there nothing to control.
 *
 * @param type Detector control type (Types.*)
 * @param states The control's detected states
 * @param name Display name for the resulting device
 * @param lookup Resolves a detected state id to the facts of the real object
 */
export function mapControlToDevice(
  type: string,
  states: DetectedState[],
  name: string,
  lookup: StateLookup,
): MapOutcome {
  const by = statesByName(states);
  // On/off carries a different pattern name depending on the control type:
  // 'light' exposes it as SET (handled directly below); the richer types use
  // ON_SET/ON/ON_ACTUAL. Do NOT fall back to SET here — for a dimmer/ct/… SET is
  // the brightness/value, not the switch, so a SET fallback would mis-map it.
  const on = firstWritable(by, ["ON_SET", "ON", "ON_ACTUAL"], lookup);
  const bri = firstWritable(by, ["DIMMER", "BRIGHTNESS"], lookup);

  /**
   * Build the outcome for a control that needs something writable to drive it.
   *
   * @param device The suggestion to return when the control is drivable.
   */
  const ifDrivable = (device: DeviceConfig): MapOutcome =>
    device.onState || device.briState
      ? { kind: "device", device: deriveScales(device, lookup) }
      : { kind: "unmapped", reason: "noWritableTarget" };

  switch (type) {
    case Types.light: {
      // For a plain light the switch is the SET state.
      const set = firstWritable(by, ["SET"], lookup);
      return set
        ? { kind: "device", device: { name, lightType: "onoff", onState: set } }
        : { kind: "unmapped", reason: "noWritableTarget" };
    }
    case Types.dimmer: {
      // For a dimmer SET is the brightness and ON_SET/ON is the switch.
      const level = firstWritable(by, ["SET"], lookup) ?? bri;
      return ifDrivable({ name, lightType: "dimmable", onState: on, briState: level });
    }
    case Types.ct:
      return ifDrivable({
        name,
        lightType: "ct",
        onState: on,
        briState: bri,
        ctState: firstWritable(by, ["TEMPERATURE"], lookup),
      });
    case Types.hue:
      return ifDrivable({
        name,
        lightType: "color",
        onState: on,
        briState: bri,
        hueState: firstWritable(by, ["HUE"], lookup),
        satState: firstWritable(by, ["SATURATION"], lookup),
        // The `hue` pattern carries TEMPERATURE too, and `lightType: "color"`
        // has a ct slot — leaving it unmapped made every scanned colour light
        // report the 250-mired placeholder for ever (2026-09-03 audit, F2).
        ctState: firstWritable(by, ["TEMPERATURE"], lookup),
      });
    case Types.cie:
      return ifDrivable({
        name,
        lightType: "color",
        onState: on,
        briState: bri,
        xyState: firstWritable(by, ["CIE"], lookup),
        ctState: firstWritable(by, ["TEMPERATURE"], lookup),
      });
    default:
      // rgb / rgbSingle / rgbwSingle: carries RED/GREEN/BLUE, no hueemu slot.
      return { kind: "unmapped", reason: "rgbChannel" };
  }
}

/** The detector control types hueemu can map (plus rgb*, reported as unmapped). */
const DETECTABLE_LIGHT_TYPES: ReadonlySet<string> = new Set([
  Types.light,
  Types.dimmer,
  Types.ct,
  Types.hue,
  Types.cie,
  Types.rgb,
  Types.rgbSingle,
  Types.rgbwSingle,
]);

/**
 * Read the facts hueemu needs from a state object. A non-state object (or a
 * missing one) yields `undefined`, which the mapping treats as "not usable".
 *
 * @param obj The object from the scanned map, if present.
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

/**
 * Scan an object map for light devices and return hueemu suggestions.
 *
 * @param objects The full ioBroker object map (id → object)
 * @param nameOf Resolve a device's display name from its id (admin language aware)
 */
export function scanForLightDevices(
  objects: Record<string, ioBroker.Object>,
  nameOf: (id: string, obj: ioBroker.Object) => string,
): ScanResult {
  const detector = new ChannelDetector();
  const keys = Object.keys(objects).sort();
  const devices: DeviceConfig[] = [];
  const unmapped: UnmappedControl[] = [];
  const usedIds: string[] = [];
  const lookup: StateLookup = id => stateFactsOf(objects[id]);

  for (const id of keys) {
    const obj = objects[id];
    if (obj?.type !== "device" && obj?.type !== "channel") {
      continue;
    }
    let controls;
    try {
      controls = detector.detect({ objects, id, _keysOptional: keys, _usedIdsOptional: usedIds });
    } catch {
      continue;
    }
    if (!controls) {
      continue;
    }
    for (const control of controls) {
      // Shortcut, deliberately without its own test: mapControlToDevice's
      // default branch reports every non-light type as an rgb channel anyway,
      // and only the types in this set ever reach it — so removing the filter
      // changes nothing observable (equivalent mutant, 2026-08-22 test audit).
      // It stays because it says which types this scan is about.
      if (!DETECTABLE_LIGHT_TYPES.has(control.type)) {
        continue;
      }
      const outcome = mapControlToDevice(control.type, control.states || [], nameOf(id, obj), lookup);
      if (outcome.kind === "device") {
        devices.push(outcome.device);
      } else {
        unmapped.push({ id, type: control.type, reason: outcome.reason });
      }
    }
  }

  return { devices, unmapped };
}
