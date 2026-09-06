/**
 * Device Binding Service
 * Handles binding between admin-configured devices and ioBroker states.
 *
 * What it is: the state cache, the light builder and the write path. What it is
 * NOT (since v1.17.0): a unit library — every Hue range, every conversion and
 * every scale derivation lives in `lib/hue-scales.ts` and is pure.
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
import {
  HUE_BRI_MAX,
  INCREMENT_ATTRIBUTES,
  applyIncrement,
  convertValueForState,
  convertValueFromState,
  deriveCtScale,
  deriveHueScale,
  deriveLevelScale,
  getDefaultValue,
  isUndecidedScale,
  scaleValueForState,
  stateFactsOf,
  type CtScale,
  type HueScale,
  type LightStateScale,
  type ScaledDevice,
} from "../lib/hue-scales";

export type { LightStateScale, HueScale, CtScale };
export { applyIncrement };

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
 * Device configuration from admin UI (jsonConfig format)
 */
export interface DeviceConfig extends ScaledDevice {
  /** Display name of the device */
  name: string;
  /** Light type (onoff, dimmable, ct, color) */
  lightType: keyof typeof LIGHT_TYPES;
  // State mappings
  /** ioBroker state ID for on/off */
  onState?: string;
  /** ioBroker state ID for brightness */
  briState?: string;
  /** ioBroker state ID for color temperature */
  ctState?: string;
  /** ioBroker state ID for hue */
  hueState?: string;
  /** ioBroker state ID for saturation */
  satState?: string;
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

/** Which scale field belongs to which mapped state, for the start-up resolution. */
const SCALE_FIELDS = [
  { state: "briState", scale: "briScale" },
  { state: "satState", scale: "satScale" },
  { state: "hueState", scale: "hueScale" },
  { state: "ctState", scale: "ctScale" },
] as const;

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
  setForeignStateAsync(id: string, state: ioBroker.SettableState): Promise<unknown>;
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
  /**
   * The device list the runtime works with. Starts as the stored configuration
   * and is replaced during {@link initialize} by the same list with every
   * undecided value scale resolved from the bound object (v1.17.0). The state
   * ids are untouched, so the id set built in the constructor stays valid.
   */
  private devices: DeviceConfig[];
  private readonly logger: Logger;
  private stateCache: Map<string, unknown> = new Map();
  /** Every state id a device maps — the only ids the cache is ever read for. */
  private readonly mappedIds: Set<string>;
  /**
   * State ids whose OBJECT does not exist. A light bound to one of them cannot
   * be driven, so it reports `reachable: false` instead of pretending (v1.17.0).
   */
  private readonly missingStates: Set<string> = new Set();
  /**
   * Last non-zero value seen per source state. The only evidence an undecided
   * scale has left on the write path when the bound object declares no range:
   * a source that reads 0..100 must be written 0..100, and a source sitting at
   * 0 right now (a lamp that is off) still remembers what it used to be.
   */
  private readonly lastNonZeroSource: Map<string, number> = new Map();

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
      if (typeof stateId === "string" && stateId) {
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

    // v1.17.0: settle every undecided scale against the bound object BEFORE the
    // first read or write, so both directions agree from the first request on.
    this.devices = await this.resolveScales(this.devices);

    // Pre-load current state values
    await this.refreshStateCache();
  }

  /**
   * v1.17.0: resolve every undecided value scale from the bound source object.
   *
   * Until v1.16.0 this only happened once, in a config migration that ran when
   * the field was ABSENT — so a light the device-manager form had written (its
   * select preselected `auto`/`raw`) never got it, and the two directions
   * disagreed for the life of that light: the read path guessed from the value,
   * the write path wrote the raw Hue number. A client setting half brightness
   * put 127 into a 0..100 % datapoint (measured, audit 2026-09-06 F1).
   *
   * Evidence rules are the ones decision 14 fixed: `common.min`/`common.max`
   * and `common.unit` only, never the role. Where the object proves nothing the
   * scale stays undecided and the heuristic applies — in BOTH directions now.
   *
   * Resolved in memory only: the stored configuration is the user's, and a
   * write to it would restart the instance on every start.
   *
   * @param devices The stored device configurations.
   * @returns the same list with the scales it could prove filled in.
   */
  private async resolveScales(devices: DeviceConfig[]): Promise<DeviceConfig[]> {
    const factsCache = new Map<string, Awaited<ReturnType<typeof stateFactsOf>>>();
    /**
     * Read the facts of one source state once, tolerating a missing object.
     *
     * @param id The state id to look up.
     */
    const factsFor = async (id: string): Promise<ReturnType<typeof stateFactsOf>> => {
      if (factsCache.has(id)) {
        return factsCache.get(id);
      }
      let facts: ReturnType<typeof stateFactsOf>;
      try {
        facts = stateFactsOf(await this.adapter.getForeignObjectAsync(id));
      } catch (error) {
        this.logger.debug(`Could not read the object of ${id}: ${errText(error)}`);
        facts = undefined;
      }
      factsCache.set(id, facts);
      return facts;
    };

    const resolved: DeviceConfig[] = [];
    for (const device of devices) {
      const patch: ScaledDevice = {};
      for (const { state, scale } of SCALE_FIELDS) {
        const stateId = device[state];
        if (typeof stateId !== "string" || !stateId || !isUndecidedScale(device[scale])) {
          continue;
        }
        const facts = await factsFor(stateId);
        const derived =
          scale === "hueScale"
            ? deriveHueScale(facts)
            : scale === "ctScale"
              ? deriveCtScale(facts)
              : deriveLevelScale(facts);
        if (derived) {
          (patch as Record<string, string>)[scale] = derived;
        }
      }
      if (Object.keys(patch).length > 0) {
        this.logger.debug(`Value scales for "${device.name}" resolved from the bound states: ${JSON.stringify(patch)}`);
        resolved.push({ ...device, ...patch });
      } else {
        resolved.push(device);
      }
    }
    return resolved;
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
            this.rememberSourceValue(stateId, state.val);
            this.stateCache.set(stateId, state.val);
          } else {
            // null = the state has no value yet OR its object doesn't exist.
            // Only the latter is a misconfiguration; warn once at init so a
            // typo'd/renamed state id isn't a silently dead binding — and mark
            // it so the light reports itself unreachable instead of pretending.
            const obj = await this.adapter.getForeignObjectAsync(stateId);
            if (!obj) {
              this.missingStates.add(stateId);
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
    // A state that reports a value proves its object exists after all.
    this.missingStates.delete(id);
    this.rememberSourceValue(id, value);
    this.stateCache.set(id, value);
  }

  /**
   * Remember the last non-zero value of a source state — the write path's only
   * evidence for an undecided scale (see {@link scaleValueForState}). Zero is
   * skipped on purpose: every scale has a zero, so it says nothing.
   *
   * @param id - Full state ID
   * @param value - The value the state reported
   */
  private rememberSourceValue(id: string, value: unknown): void {
    const n = coerceFiniteNumber(value);
    if (n !== null && n !== 0) {
      this.lastNonZeroSource.set(id, n);
    }
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
      reachable: this.isReachable(device),
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
        (state as Record<string, unknown>)[stateName] = getDefaultValue(stateName);
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
   * v1.17.0: is this light drivable at all?
   *
   * A light whose driving state has no OBJECT in the tree — a typo, a renamed
   * source, an uninstalled adapter — cannot be switched. `reachable` used to be
   * a constant `true`, so a client was told "on" for a lamp nothing could reach;
   * a real bridge reports an unreachable lamp and clients say so. The missing
   * object is already known from the cache warm-up, and the subscription clears
   * the flag the moment the state does appear.
   *
   * Only the DRIVING state counts: a colour light whose `xy` source is missing
   * is still a working lamp.
   *
   * @param device - Device configuration
   */
  private isReachable(device: DeviceConfig): boolean {
    const driving = device.onState ?? device.briState;
    return !driving || !this.missingStates.has(driving);
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
        const convertedValue = convertValueForState(
          key,
          value,
          device,
          this.logger,
          this.lastNonZeroSource.get(stateId),
        );
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
        this.rememberSourceValue(stateId, convertedValue);
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
    const target = on
      ? scaleValueForState(HUE_BRI_MAX, device.briScale, HUE_BRI_MAX, this.lastNonZeroSource.get(briState))
      : 0;
    await this.adapter.setForeignStateAsync(briState, { val: target, ack: false });
    this.rememberSourceValue(briState, target);
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
        this.rememberSourceValue(stateId, state.val);
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
   * Get state value from cache or adapter, converted into the Hue API's shape.
   *
   * @param stateId - Full ioBroker state ID
   * @param stateName - Hue state name (on, bri, ct, etc.)
   * @param device - Device configuration for scale settings
   */
  private async getStateValue(stateId: string, stateName: string, device: DeviceConfig): Promise<unknown> {
    // Try cache first
    if (this.stateCache.has(stateId)) {
      return convertValueFromState(stateName, this.stateCache.get(stateId), device, this.logger);
    }

    // Fetch from adapter
    try {
      const state = await this.adapter.getForeignStateAsync(stateId);
      if (state !== null && state !== undefined) {
        this.rememberSourceValue(stateId, state.val);
        this.stateCache.set(stateId, state.val);
        return convertValueFromState(stateName, state.val, device, this.logger);
      }
      // v1.10.0 (I1): negatively cache a missing mapped state so repeated
      // full-state polls don't re-hit the broker on every read. The foreign-state
      // subscription calls updateStateCache() if the state later appears, so this
      // self-heals (a real state with val=null caches identically).
      this.stateCache.set(stateId, null);
    } catch (error) {
      this.logger.debug(`Could not get state ${stateId}: ${errText(error)}`);
    }

    return getDefaultValue(stateName);
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
