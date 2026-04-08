/**
 * Light types for the Hue API
 */

/**
 * Hue light types
 */
export type LightType =
  | "On/Off light"
  | "On/Off plug-in unit"
  | "Dimmable light"
  | "Color temperature light"
  | "Extended color light"
  | "Color light";

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
 * Light software update state
 */
export interface LightSwUpdate {
  state:
    | "noupdates"
    | "transferring"
    | "installing"
    | "readytoinstall"
    | "anyreadytoinstall";
  lastinstall: string;
}

/**
 * Light control capabilities
 */
export interface LightControlCapabilities {
  mindimlevel?: number;
  maxlumen?: number;
  colorgamuttype?: string;
  colorgamut?: [[number, number], [number, number], [number, number]];
  ct?: {
    min: number;
    max: number;
  };
}

/**
 * Light streaming capabilities
 */
export interface LightStreamingCapabilities {
  renderer: boolean;
  proxy: boolean;
}

/**
 * Light capabilities
 */
export interface LightCapabilities {
  certified: boolean;
  control?: LightControlCapabilities;
  streaming?: LightStreamingCapabilities;
}

/**
 * Light startup configuration
 */
export interface LightStartup {
  mode: "powerfail" | "lastonstate" | "custom";
  configured: boolean;
}

/**
 * Light configuration
 */
export interface LightConfig {
  archetype?: string;
  function?: string;
  direction?: string;
  startup?: LightStartup;
}

/**
 * Full light object as returned by the Hue API
 */
export interface Light {
  /** Current light state */
  state: LightState;
  /** Software update information */
  swupdate?: LightSwUpdate;
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
  /** Light capabilities */
  capabilities?: LightCapabilities;
  /** Light configuration */
  config?: LightConfig;
  /** Unique ID (MAC-based) */
  uniqueid: string;
  /** Software version */
  swversion?: string;
  /** Software config ID */
  swconfigid?: string;
  /** Product ID */
  productid?: string;
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
