/**
 * Light types for the Hue API
 */

import type { HueErrorResponse } from "./errors";

/**
 * Hue light types (only types used by the emulator)
 */
export type LightType = "Dimmable light" | "Color temperature light" | "Extended color light";

/**
 * Light color modes
 */
export type ColorMode = "xy" | "ct" | "hs";

/**
 * Light effect types
 */
export type LightEffect = "none" | "colorloop";

/**
 * Light alert types
 */
export type LightAlert = "none" | "select" | "lselect";

/**
 * Light state
 */
export interface LightState {
  /** On/off state */
  on: boolean;
  /** Brightness (1-254) */
  bri?: number;
  /** Hue (0-65535) */
  hue?: number;
  /** Saturation (0-254) */
  sat?: number;
  /** Color temperature in mireds (153-500) */
  ct?: number;
  /** CIE x,y color coordinates */
  xy?: [number, number];
  /** Current effect */
  effect?: LightEffect;
  /** Current alert */
  alert?: LightAlert;
  /** Current color mode */
  colormode?: ColorMode;
  /** Automation mode */
  mode?: string;
  /** Is light reachable */
  reachable?: boolean;
  /** Transition time in multiples of 100ms */
  transitiontime?: number;
}

/**
 * Full light object as returned by the Hue API
 */
export interface Light {
  /** Current light state */
  state: LightState;
  /** Light type */
  type: LightType;
  /** User-defined name */
  name: string;
  /** Model ID */
  modelid: string;
  /** Manufacturer name */
  manufacturername?: string;
  /** Product name */
  productname?: string;
  /** Unique ID (MAC-based) */
  uniqueid: string;
  /** Software version */
  swversion?: string;
}

/**
 * Collection of lights indexed by ID
 */
export interface LightsCollection {
  [lightId: string]: Light;
}

/**
 * Light state update request
 */
export interface LightStateUpdate {
  /** Set on/off */
  on?: boolean;
  /** Set brightness (1-254) */
  bri?: number;
  /** Set hue (0-65535) */
  hue?: number;
  /** Set saturation (0-254) */
  sat?: number;
  /** Set color temperature in mireds (153-500) */
  ct?: number;
  /** Set CIE x,y color coordinates */
  xy?: [number, number];
  /** Set light effect */
  effect?: LightEffect;
  /** Set light alert */
  alert?: LightAlert;
  // `transitiontime` is accepted and acknowledged but NOT applied — the emulator
  // has no transition engine, and a foreign state has no fade of its own.
  // The `*_inc` fields below ARE applied since v1.15.0 (design decision 16):
  // they are resolved against the light's current value before the write, and
  // the response carries the resulting ABSOLUTE attribute.
  /** Transition time in multiples of 100ms */
  transitiontime?: number;
  /** Brightness increment/decrement */
  bri_inc?: number;
  /** Saturation increment/decrement */
  sat_inc?: number;
  /** Hue increment/decrement */
  hue_inc?: number;
  /** Color temperature increment/decrement */
  ct_inc?: number;
  /** CIE x,y increment/decrement */
  xy_inc?: [number, number];
}

/**
 * Success response for state updates
 */
export interface LightStateSuccessResponse {
  /** Success payload keyed by resource path */
  success: {
    [path: string]: unknown;
  };
}

/**
 * Result of setting light state (success or error)
 */
export type LightStateResult = LightStateSuccessResponse | HueErrorResponse;
