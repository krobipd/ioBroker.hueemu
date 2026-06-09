"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var device_binding_service_exports = {};
__export(device_binding_service_exports, {
  DeviceBindingService: () => DeviceBindingService
});
module.exports = __toCommonJS(device_binding_service_exports);
var import_errors = require("../types/errors");
var import_utils = require("../types/utils");
var import_coerce = require("../lib/coerce");
const HUE_BRI_MIN = 1;
const HUE_BRI_MAX = 254;
const HUE_HUE_MAX = 65535;
const HUE_SAT_MAX = 254;
const HUE_CT_MIN = 153;
const HUE_CT_MAX = 500;
const HUE_CT_DEFAULT = 250;
const HUE_XY_DEFAULT = [0.5, 0.5];
function clampRound(v, min, max) {
  return Math.min(max, Math.max(min, Math.round(v)));
}
const LIGHT_TYPES = {
  onoff: {
    name: "Dimmable light",
    type: "Dimmable light",
    states: ["on", "bri"],
    modelid: "LWB007"
  },
  dimmable: {
    name: "Dimmable light",
    type: "Dimmable light",
    states: ["on", "bri"],
    modelid: "LWB010"
  },
  ct: {
    name: "Color Temperature Light",
    type: "Color temperature light",
    states: ["on", "bri", "ct"],
    modelid: "LTW001"
  },
  color: {
    name: "Extended Color Light",
    type: "Extended color light",
    states: ["on", "bri", "hue", "sat", "ct", "xy"],
    modelid: "LCT003"
  }
};
const STATE_TO_CONFIG = {
  on: "onState",
  bri: "briState",
  ct: "ctState",
  hue: "hueState",
  sat: "satState",
  xy: "xyState"
};
class DeviceBindingService {
  adapter;
  devices;
  logger;
  stateCache = /* @__PURE__ */ new Map();
  /**
   * Create a new device binding service
   *
   * @param config - Device binding service configuration
   */
  constructor(config) {
    this.adapter = config.adapter;
    this.devices = config.devices || [];
    this.logger = config.logger;
  }
  /**
   * Get state ID from device config for a given state name
   *
   * @param device - Device configuration
   * @param stateName - Hue state name (on, bri, ct, etc.)
   */
  getStateId(device, stateName) {
    const configKey = STATE_TO_CONFIG[stateName];
    if (configKey) {
      return device[configKey];
    }
    return void 0;
  }
  /**
   * Get all state IDs from a device config
   *
   * @param device - Device configuration
   */
  getAllStateIds(device) {
    const stateIds = [];
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
  async initialize() {
    this.logger.debug(`Initializing device binding service with ${this.devices.length} devices`);
    for (const device of this.devices) {
      for (const stateId of this.getAllStateIds(device)) {
        this.adapter.subscribeForeignStates(stateId);
        this.logger.debug(`Subscribed to state: ${stateId}`);
      }
    }
    await this.refreshStateCache();
  }
  /**
   * Refresh the state cache
   *
   * v1.4.3 (D1): all foreign-state reads in parallel. With many devices
   * (50 lights × 6 states = 300) the previous sequential pattern blocked
   * adapter init for several broker round-trips per state.
   */
  async refreshStateCache() {
    const allIds = /* @__PURE__ */ new Set();
    for (const device of this.devices) {
      for (const id of this.getAllStateIds(device)) {
        allIds.add(id);
      }
    }
    await Promise.all(
      [...allIds].map(async (stateId) => {
        try {
          const state = await this.adapter.getForeignStateAsync(stateId);
          if (state !== null && state !== void 0) {
            this.stateCache.set(stateId, state.val);
          }
        } catch (error) {
          this.logger.debug(`Could not load state ${stateId}: ${(0, import_utils.errText)(error)}`);
        }
      })
    );
  }
  /**
   * Update state cache when a state changes
   *
   * @param id - Full state ID
   * @param value - New state value
   */
  updateStateCache(id, value) {
    this.stateCache.set(id, value);
  }
  /**
   * Get all configured lights
   *
   * v1.4.3 (D2): per-light builds in parallel. Cache hits are common after
   * `refreshStateCache`, so this rarely round-trips, but on cache misses
   * we'd previously wait for one device before starting the next.
   */
  async getAllLights() {
    const lights = {};
    const built = await Promise.all(
      this.devices.map(async (device, i) => {
        const lightId = String(i + 1);
        try {
          const light = await this.getLightById(lightId);
          return [lightId, light];
        } catch (error) {
          this.logger.warn(`Could not load device "${device.name}": ${(0, import_utils.errText)(error)}`);
          return null;
        }
      })
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
  async getLightById(lightId) {
    const index = (0, import_coerce.parseLightIndex)(lightId, this.devices.length);
    if (index === null) {
      throw import_errors.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
    }
    const device = this.devices[index];
    const lightTypeConfig = LIGHT_TYPES[device.lightType] || LIGHT_TYPES.color;
    const state = {
      reachable: true,
      mode: "homeautomation"
    };
    const mappedColorStates = /* @__PURE__ */ new Set();
    for (const stateName of lightTypeConfig.states) {
      const stateId = this.getStateId(device, stateName);
      if (stateId) {
        if (stateName === "xy" || stateName === "ct" || stateName === "hue" || stateName === "sat") {
          mappedColorStates.add(stateName);
        }
        const value = await this.getStateValue(stateId, stateName, device);
        if (value !== void 0) {
          state[stateName] = value;
        }
      } else {
        state[stateName] = this.getDefaultValue(stateName);
      }
    }
    if (state.on === void 0) {
      state.on = false;
    }
    const colormode = this.detectColorMode(mappedColorStates, state);
    if (colormode) {
      state.colormode = colormode;
    }
    const light = {
      state,
      name: device.name,
      type: lightTypeConfig.type,
      modelid: lightTypeConfig.modelid,
      manufacturername: "Signify Netherlands B.V.",
      productname: lightTypeConfig.name,
      // v1.4.3 (D5): build a valid 8-octet hex MAC suffix from the numeric
      // light index instead of repeating the decimal string. Earlier:
      // light id 100 → "100:100:100" which is not a valid MAC pair.
      uniqueid: `00:17:88:01:00:${this.lightUniqueidSuffix(index + 1)}-0b`,
      swversion: "1.0.0"
    };
    return light;
  }
  /**
   * Set light state
   *
   * @param lightId - 1-based light ID string
   * @param stateUpdate - State properties to update
   */
  async setLightState(lightId, stateUpdate) {
    const index = (0, import_coerce.parseLightIndex)(lightId, this.devices.length);
    if (index === null) {
      throw import_errors.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
    }
    const device = this.devices[index];
    const results = [];
    this.logger.debug(
      `Light ${lightId} "${device.name}": set ${Object.entries(stateUpdate).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`
    );
    for (const [key, value] of Object.entries(stateUpdate)) {
      const address = `/lights/${lightId}/state/${key}`;
      const stateId = this.getStateId(device, key);
      if (!stateId) {
        this.logger.debug(`No mapping for ${key} on device ${device.name}`);
        results.push({ success: { [address]: value } });
        continue;
      }
      try {
        const convertedValue = this.convertValueForState(key, value, device);
        await this.adapter.setForeignStateAsync(stateId, {
          val: convertedValue,
          ack: false
        });
        this.stateCache.set(stateId, convertedValue);
        results.push({ success: { [address]: value } });
        this.logger.debug(`Set ${stateId} to ${convertedValue}`);
      } catch (error) {
        this.logger.error(`Failed to set ${stateId}: ${(0, import_utils.errText)(error)}`);
        results.push(import_errors.HueApiError.resourceNotAvailable(lightId, address).toResponse());
      }
    }
    return results;
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
  detectColorMode(mapped, state) {
    if (mapped.has("xy")) {
      return "xy";
    }
    if (mapped.has("ct")) {
      return "ct";
    }
    if (mapped.has("hue") && mapped.has("sat")) {
      return "hs";
    }
    if (state.xy !== void 0) {
      return "xy";
    }
    if (state.ct !== void 0) {
      return "ct";
    }
    return void 0;
  }
  /**
   * Get state value from cache or adapter
   *
   * @param stateId - Full ioBroker state ID
   * @param stateName - Hue state name (on, bri, ct, etc.)
   * @param device - Device configuration for scale settings
   */
  async getStateValue(stateId, stateName, device) {
    if (this.stateCache.has(stateId)) {
      return this.convertValueFromState(stateName, this.stateCache.get(stateId), device);
    }
    try {
      const state = await this.adapter.getForeignStateAsync(stateId);
      if (state !== null && state !== void 0) {
        this.stateCache.set(stateId, state.val);
        return this.convertValueFromState(stateName, state.val, device);
      }
    } catch (error) {
      this.logger.debug(`Could not get state ${stateId}: ${(0, import_utils.errText)(error)}`);
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
   * @param stateName Hue API state key (`on`, `bri`, `hue`, `sat`, `ct`, `xy`)
   * @param value Raw value from the foreign state
   * @param device Device config (for the per-state scale settings)
   */
  convertValueFromState(stateName, value, device) {
    if (value === null || value === void 0) {
      return this.getDefaultValue(stateName);
    }
    switch (stateName) {
      case "on":
        if (typeof value === "string") {
          return value !== "false" && value !== "0" && value !== "";
        }
        return Boolean(value);
      case "bri":
        return this.scaleValueFromState(value, device == null ? void 0 : device.briScale, HUE_BRI_MIN, HUE_BRI_MAX, device, "bri");
      case "hue": {
        const n = (0, import_coerce.coerceFiniteNumber)(value);
        if (n === null) {
          this.logger.debug(`Default fallback for hue (device="${device == null ? void 0 : device.name}"): raw=${JSON.stringify(value)}`);
          return 0;
        }
        return clampRound(n, 0, HUE_HUE_MAX);
      }
      case "sat":
        return this.scaleValueFromState(value, device == null ? void 0 : device.satScale, 0, HUE_SAT_MAX, device, "sat");
      case "ct": {
        const n = (0, import_coerce.coerceFiniteNumber)(value);
        if (n === null) {
          this.logger.debug(`Default fallback for ct (device="${device == null ? void 0 : device.name}"): raw=${JSON.stringify(value)}`);
          return HUE_CT_DEFAULT;
        }
        return clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
      }
      case "xy": {
        if (Array.isArray(value) && value.length >= 2) {
          const x = (0, import_coerce.coerceFiniteNumber)(value[0]);
          const y = (0, import_coerce.coerceFiniteNumber)(value[1]);
          if (x !== null && y !== null) {
            return [x, y];
          }
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed.startsWith("[")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed) && parsed.length >= 2) {
                const x = (0, import_coerce.coerceFiniteNumber)(parsed[0]);
                const y = (0, import_coerce.coerceFiniteNumber)(parsed[1]);
                if (x !== null && y !== null) {
                  return [x, y];
                }
              }
            } catch {
            }
          }
          const parts = trimmed.split(",");
          if (parts.length >= 2) {
            const x = (0, import_coerce.coerceFiniteNumber)(parts[0]);
            const y = (0, import_coerce.coerceFiniteNumber)(parts[1]);
            if (x !== null && y !== null) {
              return [x, y];
            }
          }
        }
        this.logger.debug(
          `Default fallback for xy (device="${device == null ? void 0 : device.name}"): raw=${JSON.stringify(value)} not parsable`
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
  convertValueForState(stateName, value, device) {
    switch (stateName) {
      case "on":
        if (typeof value === "string") {
          return value !== "false" && value !== "0" && value !== "";
        }
        return Boolean(value);
      case "bri":
        return this.clampScaleForState(value, HUE_BRI_MIN, HUE_BRI_MAX, device == null ? void 0 : device.briScale);
      case "hue": {
        const n = (0, import_coerce.coerceFiniteNumber)(value);
        return n === null ? 0 : clampRound(n, 0, HUE_HUE_MAX);
      }
      case "sat":
        return this.clampScaleForState(value, 0, HUE_SAT_MAX, device == null ? void 0 : device.satScale);
      case "ct": {
        const n = (0, import_coerce.coerceFiniteNumber)(value);
        return n === null ? HUE_CT_DEFAULT : clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
      }
      case "xy":
        if (Array.isArray(value)) {
          return JSON.stringify(value);
        }
        return String(value);
      default:
        if (value !== null && typeof value === "object") {
          return JSON.stringify(value);
        }
        return value;
    }
  }
  /**
   * Get default value for a state
   *
   * @param stateName - Hue state name
   */
  getDefaultValue(stateName) {
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
      case "effect":
        return "none";
      case "alert":
        return "none";
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
  scaleValueFromState(value, scale, min, max, device, stateName) {
    var _a;
    const n = (0, import_coerce.coerceFiniteNumber)(value);
    if (n === null) {
      this.logger.debug(
        `Default fallback for ${stateName != null ? stateName : "?"} (device="${device == null ? void 0 : device.name}"): raw=${JSON.stringify(value)}`
      );
      return max;
    }
    const mode = scale != null ? scale : "auto";
    switch (mode) {
      case "percent":
        return clampRound(n / 100 * max, min, max);
      case "normalized":
        return clampRound(n * max, min, max);
      case "raw":
        return clampRound(n, min, max);
      case "auto":
      default: {
        let branch;
        let result;
        if (n <= 1) {
          branch = "le1";
          result = clampRound(n * max, min, max);
        } else if (n <= 100) {
          branch = "le100";
          result = clampRound(n / 100 * max, min, max);
        } else {
          branch = "raw";
          result = clampRound(n, min, max);
        }
        this.logger.debug(`scale-auto[${(_a = device == null ? void 0 : device.name) != null ? _a : "?"}/${stateName != null ? stateName : "?"}/${branch}]: n=${n} \u2192 ${result}`);
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
  scaleValueForState(hueValue, scale, max) {
    const mode = scale != null ? scale : "auto";
    switch (mode) {
      case "percent":
        return Math.round(hueValue / max * 100 * 10) / 10;
      case "normalized":
        return Math.round(hueValue / max * 1e3) / 1e3;
      case "raw":
      case "auto":
      default:
        return hueValue;
    }
  }
  /**
   * Write-path helper for bri/sat: coerce + clamp the incoming Hue value into
   * [min,max], then scale it back into the configured foreign-state scale.
   * Null/non-finite input maps to max (full), matching the per-state default.
   *
   * @param value - Raw value from the Hue API
   * @param min - Minimum Hue API value (inclusive)
   * @param max - Maximum Hue API value (inclusive)
   * @param scale - Configured scale mode for the foreign state
   */
  clampScaleForState(value, min, max, scale) {
    const n = (0, import_coerce.coerceFiniteNumber)(value);
    const clamped = n === null ? max : clampRound(n, min, max);
    return this.scaleValueForState(clamped, scale, max);
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
  lightUniqueidSuffix(oneBasedIndex) {
    const n = oneBasedIndex >>> 0;
    const b0 = n >>> 16 & 255;
    const b1 = n >>> 8 & 255;
    const b2 = n & 255;
    return [b0, b1, b2].map((b) => b.toString(16).padStart(2, "0")).join(":");
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeviceBindingService
});
//# sourceMappingURL=device-binding-service.js.map
