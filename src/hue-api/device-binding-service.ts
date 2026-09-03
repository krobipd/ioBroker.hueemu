/**
 * Device Binding Service
 * Handles binding between admin-configured devices and ioBroker states
 */

import type { Logger } from "../types/config";
import type {
  Light,
  LightsCollection,
  LightState,
  LightStateUpdate,
  LightStateResult,
  ColorMode,
} from "../types/light";
import { HueApiError } from "../types/errors";
import { errText } from "../types/utils";
import { coerceBool, coerceFiniteNumber, parseLightIndex } from "../lib/coerce";

/** Hue API value ranges (per Philips Hue API specification) */
const HUE_BRI_MIN = 1;
const HUE_BRI_MAX = 254;
const HUE_HUE_MAX = 65535;
const HUE_SAT_MAX = 254;
const HUE_CT_MIN = 153;
const HUE_CT_MAX = 500;
const HUE_CT_DEFAULT = 250;
const HUE_XY_DEFAULT: [number, number] = [0.5, 0.5];

/**
 * Clamp a finite number into an integer range.
 *
 * @param v Finite input number
 * @param min Minimum (inclusive)
 * @param max Maximum (inclusive)
 */
function clampRound(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/**
 * v1.10.0 (I2): scale a hue source value into the Hue 0..65535 range.
 * 'degrees' maps 0..360 → 0..65535; 'raw' (default) is already Hue-native.
 *
 * @param n Raw finite source value
 * @param scale Per-device hue scale ('raw' | 'degrees')
 */
function hueFromState(n: number, scale: HueScale | undefined): number {
  const hueValue = scale === "degrees" ? (n / 360) * HUE_HUE_MAX : n;
  return clampRound(hueValue, 0, HUE_HUE_MAX);
}

/**
 * Inverse of {@link hueFromState}: a Hue 0..65535 value back into the source scale.
 *
 * @param n Incoming Hue value (0..65535 from the client)
 * @param scale Per-device hue scale ('raw' | 'degrees')
 */
function hueForState(n: number, scale: HueScale | undefined): number {
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
function ctFromState(n: number, scale: CtScale | undefined): number {
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
function ctForState(n: number, scale: CtScale | undefined): number {
  const mired = clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
  return scale === "kelvin" ? Math.round(1_000_000 / mired) : mired;
}

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
const INCREMENT_ATTRIBUTES: Readonly<Record<string, string>> = {
  bri_inc: "bri",
  sat_inc: "sat",
  hue_inc: "hue",
  ct_inc: "ct",
  xy_inc: "xy",
};

/** Number of distinct hue values — the wrap modulus for the colour wheel. */
const HUE_HUE_SPAN = HUE_HUE_MAX + 1;

/**
 * Wrap a hue value into 0..65535. Unlike brightness, hue has no ends: one step
 * past red comes out at the other side of the wheel.
 *
 * @param value Raw (possibly out-of-range) hue value
 */
function wrapHue(value: number): number {
  return ((Math.round(value) % HUE_HUE_SPAN) + HUE_HUE_SPAN) % HUE_HUE_SPAN;
}

/**
 * Round an xy component and hold it inside the valid 0..1 colour space.
 *
 * @param v The shifted component, possibly outside the colour space
 */
const clampXyComponent = (v: number): number => Math.min(1, Math.max(0, Math.round(v * 10000) / 10000));

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

/**
 * Light type definitions matching the admin UI
 */
const LIGHT_TYPES = {
  onoff: {
    name: "Dimmable light",
    type: "Dimmable light" as const,
    states: ["on", "bri"],
    modelid: "LWB007",
  },
  dimmable: {
    name: "Dimmable light",
    type: "Dimmable light" as const,
    states: ["on", "bri"],
    modelid: "LWB010",
  },
  ct: {
    name: "Color Temperature Light",
    type: "Color temperature light" as const,
    states: ["on", "bri", "ct"],
    modelid: "LTW001",
  },
  color: {
    name: "Extended Color Light",
    type: "Extended color light" as const,
    states: ["on", "bri", "hue", "sat", "ct", "xy"],
    modelid: "LCT003",
  },
};

/**
 * v1.4.4 (D3): scale of the foreign source state. Earlier the read path
 * heuristically picked between 0..1 and 0..100 by the value itself
 * (`if (n <= 1) ×254 else if (n <= 100) ÷100×254`) — ambiguous at the
 * boundary: a `level.dimmer` storing 1 (= 1 %) collapsed to bri 254
 * (full bright). Now the user picks the scale per device per state.
 *
 * `auto` = legacy heuristic (default, keeps existing setups working).
 * `percent` = 0..100 → 1..254
 * `normalized` = 0..1 → 1..254
 * `raw` = 1..254 (Hue native), value passed through with clamp
 */
export type LightStateScale = "auto" | "percent" | "normalized" | "raw";
/** Scale for the hue source state: 'raw' = 0..65535 (Hue native), 'degrees' = 0..360. */
export type HueScale = "raw" | "degrees";
/** Scale for the ct source state: 'raw' = 153..500 mired (Hue native), 'kelvin' = Kelvin. */
export type CtScale = "raw" | "kelvin";

/**
 * Device configuration from admin UI (jsonConfig format)
 */
export interface DeviceConfig {
  /** Display name of the device */
  name: string;
  /** Light type (onoff, dimmable, ct, color) */
  lightType: keyof typeof LIGHT_TYPES;
  // State mappings
  /** ioBroker state ID for on/off */
  onState?: string;
  /** ioBroker state ID for brightness */
  briState?: string;
  /** Scale of the brightness source state */
  briScale?: LightStateScale;
  /** ioBroker state ID for color temperature */
  ctState?: string;
  /** Scale of the color-temperature source state */
  ctScale?: CtScale;
  /** ioBroker state ID for hue */
  hueState?: string;
  /** Scale of the hue source state */
  hueScale?: HueScale;
  /** ioBroker state ID for saturation */
  satState?: string;
  /** Scale of the saturation source state */
  satScale?: LightStateScale;
  /** ioBroker state ID for XY color */
  xyState?: string;
}

/**
 * Maps Hue state names to DeviceConfig property names
 */
const STATE_TO_CONFIG: Record<string, keyof DeviceConfig> = {
  on: "onState",
  bri: "briState",
  ct: "ctState",
  hue: "hueState",
  sat: "satState",
  xy: "xyState",
};

/**
 * Adapter interface for device binding service
 */
export interface DeviceBindingAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** ioBroker logger */
  log: ioBroker.Logger;
  /** Read a foreign state by ID */
  getForeignStateAsync(id: string): Promise<ioBroker.State | null | undefined>;
  /** Read a foreign object by ID (to tell "missing object" from "unset value") */
  getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
  /** Write a foreign state by ID */
  setForeignStateAsync(id: string, state: ioBroker.SettableState): Promise<void>;
  /** Subscribe to foreign state changes */
  subscribeForeignStates(pattern: string): void;
}

/**
 * Device binding service configuration
 */
export interface DeviceBindingServiceConfig {
  /** Adapter instance for state access */
  adapter: DeviceBindingAdapter;
  /** Device configurations from admin UI */
  devices: DeviceConfig[];
  /** Logger instance */
  logger: Logger;
}

/**
 * Service for managing device bindings from admin configuration
 */
export class DeviceBindingService {
  private readonly adapter: DeviceBindingAdapter;
  private readonly devices: DeviceConfig[];
  private readonly logger: Logger;
  private stateCache: Map<string, unknown> = new Map();
  /** Every state id a device maps — the only ids the cache is ever read for. */
  private readonly mappedIds: Set<string>;

  /**
   * Create a new device binding service
   *
   * @param config - Device binding service configuration
   */
  constructor(config: DeviceBindingServiceConfig) {
    this.adapter = config.adapter;
    this.devices = config.devices || [];
    this.logger = config.logger;
    this.mappedIds = new Set(this.devices.flatMap(device => this.getAllStateIds(device)));
  }

  /**
   * Get state ID from device config for a given state name
   *
   * @param device - Device configuration
   * @param stateName - Hue state name (on, bri, ct, etc.)
   */
  private getStateId(device: DeviceConfig, stateName: string): string | undefined {
    const configKey = STATE_TO_CONFIG[stateName];
    if (configKey) {
      return device[configKey];
    }
    return undefined;
  }

  /**
   * Get all state IDs from a device config
   *
   * @param device - Device configuration
   */
  private getAllStateIds(device: DeviceConfig): string[] {
    const stateIds: string[] = [];
    for (const configKey of Object.values(STATE_TO_CONFIG)) {
      const stateId = device[configKey];
      if (stateId) {
        stateIds.push(stateId);
      }
    }
    return stateIds;
  }

  /**
   * Initialize the service - subscribe to all mapped states
   */
  public async initialize(): Promise<void> {
    this.logger.debug(`Initializing device binding service with ${this.devices.length} devices`);

    // Subscribe to all mapped states
    for (const device of this.devices) {
      for (const stateId of this.getAllStateIds(device)) {
        this.adapter.subscribeForeignStates(stateId);
        this.logger.debug(`Subscribed to state: ${stateId}`);
      }
    }

    // Warn once if a colour-capable light has no colour state mapped — it would
    // otherwise silently report default colours with no diagnostic thread.
    for (const device of this.devices) {
      const cfg = LIGHT_TYPES[device.lightType];
      const colourStates = cfg ? cfg.states.filter(s => s === "hue" || s === "sat" || s === "ct" || s === "xy") : [];
      if (colourStates.length > 0 && !colourStates.some(s => this.getStateId(device, s))) {
        this.logger.warn(
          `Device "${device.name}" is configured as "${device.lightType}" but no colour state (${colourStates.join("/")}) is mapped — it will report default colours`,
        );
      }
    }

    // Pre-load current state values
    await this.refreshStateCache();
  }

  /**
   * Refresh the state cache
   *
   * v1.4.3 (D1): all foreign-state reads in parallel. With many devices
   * (50 lights × 6 states = 300) the previous sequential pattern blocked
   * adapter init for several broker round-trips per state.
   */
  private async refreshStateCache(): Promise<void> {
    await Promise.all(
      [...this.mappedIds].map(async stateId => {
        try {
          const state = await this.adapter.getForeignStateAsync(stateId);
          if (state !== null && state !== undefined) {
            this.stateCache.set(stateId, state.val);
          } else {
            // null = the state has no value yet OR its object doesn't exist.
            // Only the latter is a misconfiguration; warn once at init so a
            // typo'd/renamed state id isn't a silently dead binding.
            const obj = await this.adapter.getForeignObjectAsync(stateId);
            if (!obj) {
              this.logger.warn(
                `Configured state "${stateId}" does not exist — the bound light will report default values`,
              );
            }
          }
        } catch (error) {
          this.logger.debug(`Could not load state ${stateId}: ${errText(error)}`);
        }
      }),
    );
  }

  /**
   * Update state cache when a state changes
   *
   * @param id - Full state ID
   * @param value - New state value
   */
  public updateStateCache(id: string, value: unknown): void {
    // The adapter forwards every acked change it is subscribed to — its own
    // startPairing/disableAuth/clients.* included. Only mapped ids are ever
    // read, so only those are kept; the cache would otherwise grow by one
    // entry per paired client for nothing.
    if (!this.mappedIds.has(id)) {
      return;
    }
    this.stateCache.set(id, value);
  }

  /**
   * 1-based light id strings for all configured devices. Cheap (no state reads)
   * — used by group actions to fan out without rebuilding every light first.
   */
  public getLightIds(): string[] {
    return this.devices.map((_, i) => String(i + 1));
  }

  /**
   * Get all configured lights
   *
   * v1.4.3 (D2): per-light builds in parallel. Cache hits are common after
   * `refreshStateCache`, so this rarely round-trips, but on cache misses
   * we'd previously wait for one device before starting the next.
   */
  public async getAllLights(): Promise<LightsCollection> {
    const lights: LightsCollection = {};

    const built = await Promise.all(
      this.devices.map(async (device, i) => {
        const lightId = String(i + 1);
        try {
          const light = await this.getLightById(lightId);
          return [lightId, light] as const;
        } catch (error) {
          this.logger.warn(`Could not load device "${device.name}": ${errText(error)}`);
          return null;
        }
      }),
    );
    for (const entry of built) {
      if (entry) {
        lights[entry[0]] = entry[1];
      }
    }

    return lights;
  }

  /**
   * Get a single light by ID
   *
   * v1.4.3 (E1): strict integer validation via `parseLightIndex`. Earlier
   * `parseInt("abc")` returned `NaN`; both `NaN < 0` and `NaN >= length`
   * evaluate false, so we accessed `devices[NaN]` (undefined) and crashed
   * later with a confusing TypeError. Now bad ids surface as Hue
   * `resourceNotAvailable` (404) at the boundary.
   *
   * @param lightId - 1-based light ID string
   */
  public async getLightById(lightId: string): Promise<Light> {
    const index = parseLightIndex(lightId, this.devices.length);
    if (index === null) {
      throw HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
    }

    const device = this.devices[index];
    const lightTypeConfig = LIGHT_TYPES[device.lightType] || LIGHT_TYPES.color;

    // Build state object from mappings. Track which colour states the device
    // actually maps (vs. defaulted placeholders) so colormode reflects reality.
    const state: Partial<LightState> = {
      reachable: true,
      mode: "homeautomation",
    };
    const mappedColorStates = new Set<string>();

    for (const stateName of lightTypeConfig.states) {
      const stateId = this.getStateId(device, stateName);
      if (stateId) {
        if (stateName === "xy" || stateName === "ct" || stateName === "hue" || stateName === "sat") {
          mappedColorStates.add(stateName);
        }
        const value = await this.getStateValue(stateId, stateName, device);
        if (value !== undefined) {
          (state as Record<string, unknown>)[stateName] = value;
        }
      } else if (stateName === "on" && device.briState) {
        // v1.15.0: a light with no switch of its own — brightness carries on/off.
        // Plenty of real dimmers have no boolean state at all (a HomeMatic
        // HmIP-BDT channel exposes LEVEL and nothing else), so the source value
        // itself is the truth: 0 = off, anything above = on. Read from the
        // SOURCE, never from the assembled Hue `bri` — that one defaults to 254.
        (state as Record<string, unknown>).on = await this.brightnessImpliesOn(device);
      } else {
        // Provide default values for unmapped states
        (state as Record<string, unknown>)[stateName] = this.getDefaultValue(stateName);
      }
    }

    // Ensure 'on' state exists
    if (state.on === undefined) {
      state.on = false;
    }

    const colormode = this.detectColorMode(mappedColorStates, state);
    if (colormode) {
      state.colormode = colormode;
    }

    // Real Hue lights always carry effect/alert. hueemu has no effect or alert
    // engine, so they are constant "none" — surfaced here for client spec-parity.
    state.effect = "none";
    state.alert = "none";

    const light: Light = {
      state: state as LightState,
      name: device.name,
      type: lightTypeConfig.type,
      modelid: lightTypeConfig.modelid,
      manufacturername: "Signify Netherlands B.V.",
      productname: lightTypeConfig.name,
      // v1.4.3 (D5): build a valid 8-octet hex MAC suffix from the numeric
      // light index instead of repeating the decimal string. Earlier:
      // light id 100 → "100:100:100" which is not a valid MAC pair.
      uniqueid: `00:17:88:01:00:${this.lightUniqueidSuffix(index + 1)}-0b`,
      swversion: "1.0.0",
    };

    return light;
  }

  /**
   * Set light state
   *
   * @param lightId - 1-based light ID string
   * @param stateUpdate - State properties to update
   */
  public async setLightState(lightId: string, stateUpdate: LightStateUpdate): Promise<LightStateResult[]> {
    const index = parseLightIndex(lightId, this.devices.length);
    if (index === null) {
      throw HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
    }

    const device = this.devices[index];
    const results: LightStateResult[] = [];

    this.logger.debug(
      `Light ${lightId} "${device.name}": set ${Object.entries(stateUpdate)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ")}`,
    );

    // v1.15.0: turn every relative attribute into its absolute equivalent BEFORE
    // the write loop, so the rest of the path (and the response) needs to know
    // about one kind of attribute only.
    const effective = await this.resolveIncrements(device, stateUpdate);

    // A light without its own switch is turned off by writing brightness 0 — so
    // a brightness in the SAME request would immediately switch it back on and
    // "off" would silently do nothing. Off wins; the brightness is acknowledged
    // (a real bridge stores it for the next on, which a bare level state cannot).
    const body = effective as Record<string, unknown>;
    const switchedOffViaBrightness = !device.onState && !!device.briState && "on" in body && !coerceBool(body.on);

    for (const [key, value] of Object.entries(effective)) {
      const address = `/lights/${lightId}/state/${key}`;
      const stateId = this.getStateId(device, key);

      if (switchedOffViaBrightness && key === "bri") {
        this.logger.debug(`"${device.name}": ignoring bri — the same request switches the light off`);
        results.push({ success: { [address]: value } });
        continue;
      }

      if (!stateId) {
        // v1.15.0: a light whose only writable target is brightness still has to
        // switch. Brightness carries on/off for it (see mapControlToDevice).
        if (key === "on" && device.briState) {
          try {
            await this.switchViaBrightness(device, value, effective);
            results.push({ success: { [address]: value } });
          } catch (error) {
            this.logger.error(`Failed to switch "${device.name}" via brightness: ${errText(error)}`);
            results.push(HueApiError.resourceNotAvailable(lightId, address).toResponse());
          }
          continue;
        }
        this.logger.debug(`No mapping for ${key} on device ${device.name}`);
        // Still report success for unmapped states (some clients expect this)
        results.push({ success: { [address]: value } });
        continue;
      }

      try {
        const convertedValue = this.convertValueForState(key, value, device);
        if (convertedValue === undefined) {
          // Invalid payload for this attribute (a non-array xy, a non-numeric
          // bri/sat/hue/ct). Skip the write rather than poison the state or set a
          // default the client never asked for; still ack like a real bridge.
          results.push({ success: { [address]: value } });
          continue;
        }
        await this.adapter.setForeignStateAsync(stateId, {
          val: convertedValue,
          ack: false,
        });
        this.stateCache.set(stateId, convertedValue);
        results.push({ success: { [address]: value } });
        this.logger.debug(`Set ${stateId} to ${convertedValue}`);
      } catch (error) {
        this.logger.error(`Failed to set ${stateId}: ${errText(error)}`);
        results.push(HueApiError.resourceNotAvailable(lightId, address).toResponse());
      }
    }

    return results;
  }

  /**
   * v1.15.0: replace every relative attribute (`bri_inc`, `sat_inc`, `hue_inc`,
   * `ct_inc`, `xy_inc`) by its absolute equivalent, computed from the light's
   * current value. Returns the original object untouched when there is nothing
   * to resolve.
   *
   * A relative attribute is left in place — and therefore acknowledged without a
   * write, exactly like any unmapped attribute — when the light does not map the
   * base attribute or the payload is unusable. That is deliberately the same
   * rule the absolute path already follows; no new special case.
   *
   * @param device - Device configuration
   * @param stateUpdate - The incoming state update
   */
  private async resolveIncrements(device: DeviceConfig, stateUpdate: LightStateUpdate): Promise<LightStateUpdate> {
    const body = stateUpdate as Record<string, unknown>;
    let resolved: Record<string, unknown> | null = null;

    for (const [incKey, base] of Object.entries(INCREMENT_ATTRIBUTES)) {
      if (!(incKey in body)) {
        continue;
      }
      // Spec: the increment is ignored when the absolute value is also given.
      if (base in body) {
        resolved ??= { ...body };
        delete resolved[incKey];
        this.logger.debug(`Ignoring ${incKey} for "${device.name}" — ${base} is set in the same request`);
        continue;
      }
      const stateId = this.getStateId(device, base);
      if (!stateId) {
        continue;
      }
      const current = await this.getStateValue(stateId, base, device);
      const next = applyIncrement(base, current, body[incKey]);
      if (next === undefined) {
        this.logger.debug(`Ignoring invalid ${incKey} for "${device.name}": raw=${JSON.stringify(body[incKey])}`);
        continue;
      }
      resolved ??= { ...body };
      delete resolved[incKey];
      resolved[base] = next;
      this.logger.debug(`${incKey} on "${device.name}": ${JSON.stringify(current)} → ${JSON.stringify(next)}`);
    }

    return resolved ?? body;
  }

  /**
   * v1.15.0: switch a light that has no switch of its own by writing its
   * brightness. Off writes a plain 0 (that means "off" in every supported
   * scale); on writes full brightness, because a source sitting at 0 carries no
   * memory of what it used to be.
   *
   * When the very same request also brings an explicit `bri`, the switch-on
   * write is skipped and that value does the turning on — otherwise the lamp
   * would visibly jump to full brightness first.
   *
   * @param device - Device configuration (with a mapped briState)
   * @param value - The `on` value the client sent
   * @param update - The full (already increment-resolved) request body
   */
  private async switchViaBrightness(device: DeviceConfig, value: unknown, update: LightStateUpdate): Promise<void> {
    const briState = device.briState;
    if (!briState) {
      return;
    }
    const on = coerceBool(value);
    if (on && "bri" in (update as Record<string, unknown>)) {
      this.logger.debug(`"${device.name}": on handled by the bri in the same request`);
      return;
    }
    const target = on ? this.scaleValueForState(HUE_BRI_MAX, device.briScale, HUE_BRI_MAX) : 0;
    await this.adapter.setForeignStateAsync(briState, { val: target, ack: false });
    this.stateCache.set(briState, target);
    this.logger.debug(`"${device.name}": switched ${on ? "on" : "off"} via brightness → ${target}`);
  }

  /**
   * Derive the Hue `colormode` from the colour states the device actually
   * maps, not from defaulted placeholders. Priority xy > ct > hs matches real
   * Hue. A `color` light always carries a defaulted `xy`, so without the
   * "mapped" distinction every colour light would report `xy` even when the
   * user only bound hue/sat — a client honouring colormode would then render
   * the [0.5,0.5] default instead of the actual hue/sat colour. Falls back to
   * whichever colour state carries a (default) value when nothing is mapped.
   *
   * @param mapped Colour state names (xy/ct/hue/sat) that have a configured stateId.
   * @param state The assembled light state (carries defaulted values).
   */
  private detectColorMode(mapped: Set<string>, state: Partial<LightState>): ColorMode | undefined {
    if (mapped.has("xy")) {
      return "xy";
    }
    if (mapped.has("ct")) {
      return "ct";
    }
    if (mapped.has("hue") || mapped.has("sat")) {
      return "hs";
    }
    if (state.xy !== undefined) {
      return "xy";
    }
    if (state.ct !== undefined) {
      return "ct";
    }
    return undefined;
  }

  /**
   * Read the RAW source value of a mapped state (cache first), without any Hue
   * conversion. The converted read path defaults a missing value to a sensible
   * Hue value (bri → 254), which is exactly wrong when the question is
   * "is there any brightness at all?".
   *
   * @param stateId - Full ioBroker state ID
   */
  private async rawSourceValue(stateId: string): Promise<unknown> {
    if (this.stateCache.has(stateId)) {
      return this.stateCache.get(stateId);
    }
    try {
      const state = await this.adapter.getForeignStateAsync(stateId);
      if (state !== null && state !== undefined) {
        this.stateCache.set(stateId, state.val);
        return state.val;
      }
      // Same negative caching as getStateValue (v1.10.0 I1) — the subscription
      // heals it if the state appears later.
      this.stateCache.set(stateId, null);
    } catch (error) {
      this.logger.debug(`Could not get state ${stateId}: ${errText(error)}`);
    }
    return null;
  }

  /**
   * v1.15.0: on/off for a light whose only writable target is brightness.
   * A source value above zero means the light is on.
   *
   * @param device - Device configuration
   */
  private async brightnessImpliesOn(device: DeviceConfig): Promise<boolean> {
    if (!device.briState) {
      return false;
    }
    const n = coerceFiniteNumber(await this.rawSourceValue(device.briState));
    return n !== null && n > 0;
  }

  /**
   * Get state value from cache or adapter
   *
   * @param stateId - Full ioBroker state ID
   * @param stateName - Hue state name (on, bri, ct, etc.)
   * @param device - Device configuration for scale settings
   */
  private async getStateValue(stateId: string, stateName: string, device: DeviceConfig): Promise<unknown> {
    // Try cache first
    if (this.stateCache.has(stateId)) {
      return this.convertValueFromState(stateName, this.stateCache.get(stateId), device);
    }

    // Fetch from adapter
    try {
      const state = await this.adapter.getForeignStateAsync(stateId);
      if (state !== null && state !== undefined) {
        this.stateCache.set(stateId, state.val);
        return this.convertValueFromState(stateName, state.val, device);
      }
      // v1.10.0 (I1): negatively cache a missing mapped state so repeated
      // full-state polls don't re-hit the broker on every read. The foreign-state
      // subscription calls updateStateCache() if the state later appears, so this
      // self-heals (a real state with val=null caches identically).
      this.stateCache.set(stateId, null);
    } catch (error) {
      this.logger.debug(`Could not get state ${stateId}: ${errText(error)}`);
    }

    return this.getDefaultValue(stateName);
  }

  /**
   * Convert value from ioBroker state to Hue API format.
   *
   * v1.4.4 (D3): bri/sat scale is configurable per device. Earlier code
   * used a value-based heuristic (`if n<=1 ×254 else if n<=100 ÷100×254`)
   * which collapsed 1-percent (`n=1` from a 0..100 scale) to bri 254.
   * The "auto" scale keeps that legacy behaviour for backwards compat.
   *
   * bri/sat/hue/ct each carry a per-device scale (D3 + I2): bri/sat map percent/
   * normalized/raw sources; hue maps raw (0..65535) vs degrees (0..360); ct maps
   * raw (153..500 mired) vs Kelvin. Default 'raw' is the Hue-native unit, i.e. the
   * pre-I2 behaviour — existing devices need no re-config.
   *
   * @param stateName Hue API state key (`on`, `bri`, `hue`, `sat`, `ct`, `xy`)
   * @param value Raw value from the foreign state
   * @param device Device config (for the per-state scale settings)
   */
  private convertValueFromState(stateName: string, value: unknown, device?: DeviceConfig): unknown {
    if (value === null || value === undefined) {
      return this.getDefaultValue(stateName);
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
        return this.scaleValueFromState(value, device?.briScale, HUE_BRI_MIN, HUE_BRI_MAX, device, "bri");
      case "hue": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          this.logger.debug(`Default fallback for hue (device="${device?.name}"): raw=${JSON.stringify(value)}`);
          return 0;
        }
        return hueFromState(n, device?.hueScale);
      }
      case "sat":
        return this.scaleValueFromState(value, device?.satScale, 0, HUE_SAT_MAX, device, "sat");
      case "ct": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          this.logger.debug(`Default fallback for ct (device="${device?.name}"): raw=${JSON.stringify(value)}`);
          return HUE_CT_DEFAULT;
        }
        return ctFromState(n, device?.ctScale);
      }
      case "xy": {
        // XY as array [x, y] — both entries must be finite numbers
        if (Array.isArray(value) && value.length >= 2) {
          const x = coerceFiniteNumber(value[0]);
          const y = coerceFiniteNumber(value[1]);
          if (x !== null && y !== null) {
            return [x, y] as [number, number];
          }
        }
        if (typeof value === "string") {
          // v1.4.3 (D4): we serialize xy as a JSON string on writes
          // (`"[0.3,0.4]"`), so reads must accept the round-trip too.
          // Without this, the comma-split below produced `["[0.3","0.4]"]`,
          // parseFloat("[0.3") gave NaN, and every read fell through to the
          // [0.5, 0.5] default — losing whatever the client just set.
          const trimmed = value.trim();
          if (trimmed.startsWith("[")) {
            try {
              const parsed: unknown = JSON.parse(trimmed);
              if (Array.isArray(parsed) && parsed.length >= 2) {
                const x = coerceFiniteNumber(parsed[0]);
                const y = coerceFiniteNumber(parsed[1]);
                if (x !== null && y !== null) {
                  return [x, y] as [number, number];
                }
              }
            } catch {
              /* fall through to CSV */
            }
          }
          const parts = trimmed.split(",");
          if (parts.length >= 2) {
            // v1.10.0 (L7): trim each part — coerceFiniteNumber is strict (rejects
            // surrounding whitespace), so a spaced CSV like "0.3, 0.4" would
            // otherwise fall through to the [0.5, 0.5] white default.
            const x = coerceFiniteNumber(parts[0].trim());
            const y = coerceFiniteNumber(parts[1].trim());
            if (x !== null && y !== null) {
              return [x, y] as [number, number];
            }
          }
        }
        this.logger.debug(
          `Default fallback for xy (device="${device?.name}"): raw=${JSON.stringify(value)} not parsable`,
        );
        return HUE_XY_DEFAULT;
      }
      default:
        return value;
    }
  }

  /**
   * Convert value from Hue API format to ioBroker state.
   *
   * v1.4.4 (D3): bri/sat write back in the foreign state's configured
   * scale (`auto`/`raw` keep the current Hue-native behaviour, `percent`
   * writes 0..100, `normalized` writes 0..1). Earlier the write side
   * always wrote raw 1..254 regardless of source scale, so a
   * `level.dimmer` (0..100) bound to bri ended up with values like 254
   * — confusing other consumers of that state.
   *
   * @param stateName - Hue state name (on, bri, ct, etc.)
   * @param value - Value from Hue API
   * @param device - Device configuration for scale settings
   */
  private convertValueForState(
    stateName: string,
    value: unknown,
    device?: DeviceConfig,
  ): ioBroker.StateValue | undefined {
    switch (stateName) {
      case "on":
        // v1.10.0 (M1): symmetric with the read path — shared coerceBool
        // (allowlist true/1/yes/on). Hue clients send JSON booleans; a malformed
        // string body ("off", "no", …) must not flip a light on.
        return coerceBool(value);
      case "bri":
        return this.clampScaleForState(value, HUE_BRI_MIN, HUE_BRI_MAX, device?.briScale, device, "bri");
      case "hue": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          this.logger.debug(`Ignoring invalid hue write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
          return undefined;
        }
        return hueForState(n, device?.hueScale);
      }
      case "sat":
        return this.clampScaleForState(value, 0, HUE_SAT_MAX, device?.satScale, device, "sat");
      case "ct": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          this.logger.debug(`Ignoring invalid ct write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
          return undefined;
        }
        return ctForState(n, device?.ctScale);
      }
      case "xy": {
        // Only a 2-element finite-number array (or its JSON round-trip) is a
        // valid xy. Anything else (object, bare number) would serialize to junk
        // like "[object Object]" — return undefined so the caller skips the
        // write instead of poisoning the foreign state.
        if (Array.isArray(value) && value.length >= 2) {
          const x = coerceFiniteNumber(value[0]);
          const y = coerceFiniteNumber(value[1]);
          if (x !== null && y !== null) {
            return JSON.stringify([x, y]);
          }
        }
        this.logger.debug(`Ignoring invalid xy write (device="${device?.name}"): raw=${JSON.stringify(value)}`);
        return undefined;
      }
      default:
        if (value !== null && typeof value === "object") {
          return JSON.stringify(value);
        }
        return value as ioBroker.StateValue;
    }
  }

  /**
   * Get default value for a state
   *
   * @param stateName - Hue state name
   */
  private getDefaultValue(stateName: string): unknown {
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
   * v1.4.4 (D3): coerce a foreign-state value into the Hue API integer
   * range (`min..max`) according to the configured scale.
   *
   * - `auto` (default) — legacy heuristic: `<=1` ×max, `<=100` /100×max,
   *   otherwise pass through clamped. Kept for backwards compatibility.
   * - `percent` — input is 0..100, mapped to `min..max`. A stored 1 means
   *   1 % and maps to 1 % of max (was the bug-trigger under `auto`).
   * - `normalized` — input is 0..1, mapped to 0..max.
   * - `raw` — input is already in `min..max` (Hue native), passed through
   *   with clamp + round.
   *
   * `null` / non-finite input always returns `max` (current default).
   *
   * @param value - Raw value from the foreign state
   * @param scale - Configured scale mode
   * @param min - Minimum Hue API value (inclusive)
   * @param max - Maximum Hue API value (inclusive)
   * @param device - Device configuration for logging
   * @param stateName - State name for logging
   */
  private scaleValueFromState(
    value: unknown,
    scale: LightStateScale | undefined,
    min: number,
    max: number,
    device?: DeviceConfig,
    stateName?: string,
  ): number {
    const n = coerceFiniteNumber(value);
    if (n === null) {
      this.logger.debug(
        `Default fallback for ${stateName ?? "?"} (device="${device?.name}"): raw=${JSON.stringify(value)}`,
      );
      return max;
    }
    const mode: LightStateScale = scale ?? "auto";
    switch (mode) {
      case "percent":
        return clampRound((n / 100) * max, min, max);
      case "normalized":
        return clampRound(n * max, min, max);
      case "raw":
        return clampRound(n, min, max);
      case "auto":
      default: {
        let branch: string;
        let result: number;
        if (n <= 1) {
          branch = "le1";
          result = clampRound(n * max, min, max);
        } else if (n <= 100) {
          branch = "le100";
          result = clampRound((n / 100) * max, min, max);
        } else {
          branch = "raw";
          result = clampRound(n, min, max);
        }
        this.logger.debug(`scale-auto[${device?.name ?? "?"}/${stateName ?? "?"}/${branch}]: n=${n} → ${result}`);
        return result;
      }
    }
  }

  /**
   * v1.4.4 (D3): inverse of {@link scaleValueFromState} — convert a Hue
   * value (1..254) back into the configured foreign-state scale on write.
   * Earlier the write side always wrote raw Hue values regardless of the
   * source scale: a `level.dimmer` (0..100) bound to bri got values like
   * 254 written into it, breaking other adapters that read it.
   *
   * @param hueValue - Hue-native value (1..254)
   * @param scale - Configured scale mode for the foreign state
   * @param max - Maximum Hue API value
   */
  private scaleValueForState(hueValue: number, scale: LightStateScale | undefined, max: number): number {
    const mode: LightStateScale = scale ?? "auto";
    switch (mode) {
      case "percent":
        // Round to one decimal so 254/254 → 100, 127/254 → 50.0
        return Math.round((hueValue / max) * 100 * 10) / 10;
      case "normalized":
        return Math.round((hueValue / max) * 1000) / 1000;
      case "raw":
      case "auto":
      default:
        return hueValue;
    }
  }

  /**
   * Write-path helper for bri/sat: coerce + clamp the incoming Hue value into
   * [min,max], then scale it back into the configured foreign-state scale.
   * Null/non-finite input is not written at all (undefined → the caller skips
   * the write and still acks, like the xy path) — a default the client never
   * asked for must not land in the foreign state.
   *
   * @param value - Raw value from the Hue API
   * @param min - Minimum Hue API value (inclusive)
   * @param max - Maximum Hue API value (inclusive)
   * @param scale - Configured scale mode for the foreign state
   * @param device - Device configuration (used for the fallback log)
   * @param stateName - State name (used for the fallback log)
   */
  private clampScaleForState(
    value: unknown,
    min: number,
    max: number,
    scale: LightStateScale | undefined,
    device?: DeviceConfig,
    stateName?: string,
  ): number | undefined {
    const n = coerceFiniteNumber(value);
    if (n === null) {
      this.logger.debug(
        `Ignoring invalid ${stateName ?? "?"} write (device="${device?.name}"): raw=${JSON.stringify(value)}`,
      );
      return undefined;
    }
    return this.scaleValueForState(clampRound(n, min, max), scale, max);
  }

  /**
   * Build the trailing 3-octet MAC suffix for a Hue `uniqueid`. The full
   * uniqueid is `00:17:88:01:00:<3-octet-suffix>-0b` (8 pairs + endpoint),
   * matching real Hue bridges. Encodes the 1-based light index as 24 bits,
   * giving stable, valid hex even at large counts (light 1 → `00:00:01`,
   * light 256 → `00:01:00`, light 16777215 → `ff:ff:ff`). Above 24 bits
   * the value wraps — far beyond Hue's practical 50-light limit.
   *
   * @param oneBasedIndex 1-based light index.
   */
  private lightUniqueidSuffix(oneBasedIndex: number): string {
    const n = oneBasedIndex >>> 0;
    const b0 = (n >>> 16) & 0xff;
    const b1 = (n >>> 8) & 0xff;
    const b2 = n & 0xff;
    return [b0, b1, b2].map(b => b.toString(16).padStart(2, "0")).join(":");
  }
}
