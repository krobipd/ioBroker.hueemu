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
 */

import ChannelDetector, { Types } from "@iobroker/type-detector";
import type { DeviceConfig } from "../hue-api";

/** Minimal shape of a detected state — only the fields the mapping consumes. */
interface DetectedState {
  name: string;
  id?: string;
}

/** A light control the detector found but hueemu cannot map (e.g. an RGB channel). */
export interface UnmappedControl {
  /** The device/channel id the control was detected on. */
  id: string;
  /** The detector type (e.g. "rgb"). */
  type: string;
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

/**
 * Map one detected control to a hueemu DeviceConfig. Returns null when the
 * control type has no hueemu equivalent (RGB channels) or lacks an on/off state.
 *
 * @param type Detector control type (Types.*)
 * @param states The control's detected states
 * @param name Display name for the resulting device
 */
export function mapControlToDevice(type: string, states: DetectedState[], name: string): DeviceConfig | null {
  const by = statesByName(states);
  // On/off carries a different pattern name depending on the control type:
  // 'light' exposes it as SET (handled directly below); the richer types use
  // ON_SET/ON/ON_ACTUAL. Do NOT fall back to SET here — for a dimmer/ct/… SET is
  // the brightness/value, not the switch, so a SET fallback would mis-map it.
  const on = by.get("ON_SET") ?? by.get("ON") ?? by.get("ON_ACTUAL");
  const bri = by.get("DIMMER") ?? by.get("BRIGHTNESS");

  switch (type) {
    case Types.light:
      // For a plain light the switch is the SET state.
      return by.get("SET") ? { name, lightType: "onoff", onState: by.get("SET") } : null;
    case Types.dimmer:
      // For a dimmer SET is the brightness and ON_SET/ON is the switch.
      return on ? { name, lightType: "dimmable", onState: on, briState: by.get("SET") ?? bri } : null;
    case Types.ct:
      return on ? { name, lightType: "ct", onState: on, briState: bri, ctState: by.get("TEMPERATURE") } : null;
    case Types.hue:
      return on
        ? {
            name,
            lightType: "color",
            onState: on,
            briState: bri,
            hueState: by.get("HUE"),
            satState: by.get("SATURATION"),
          }
        : null;
    case Types.cie:
      return on ? { name, lightType: "color", onState: on, briState: bri, xyState: by.get("CIE") } : null;
    default:
      // rgb / rgbSingle / rgbwSingle and anything non-light: no hueemu slot.
      return null;
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
      // default branch returns null for every non-light type anyway, and only
      // rgb* (which IS in this set) reaches the unmapped list — so removing the
      // filter changes nothing observable (equivalent mutant, 2026-08-22 test
      // audit). It stays because it says which types this scan is about.
      if (!DETECTABLE_LIGHT_TYPES.has(control.type)) {
        continue;
      }
      const device = mapControlToDevice(control.type, control.states || [], nameOf(id, obj));
      if (device) {
        devices.push(device);
      } else if (control.type === Types.rgb || control.type === Types.rgbSingle || control.type === Types.rgbwSingle) {
        unmapped.push({ id, type: control.type });
      }
    }
  }

  return { devices, unmapped };
}
