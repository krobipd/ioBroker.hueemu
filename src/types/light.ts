/**
 * Light types for the Hue API
 */

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
  on?: boolean;
  bri?: number;
  hue?: number;
  sat?: number;
  ct?: number;
  xy?: [number, number];
  effect?: LightEffect;
  alert?: LightAlert;
  transitiontime?: number;
  bri_inc?: number;
  sat_inc?: number;
  hue_inc?: number;
  ct_inc?: number;
  xy_inc?: [number, number];
}

/**
 * Success response for state updates
 */
export interface LightStateSuccessResponse {
  success: {
    [path: string]: unknown;
  };
}

/**
 * Result of setting light state (success or error)
 */
export type LightStateResult =
  | LightStateSuccessResponse
  | { error: { type: number; address: string; description: string } };
