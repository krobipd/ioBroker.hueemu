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
const HUE_BRI_MIN = 1;
const HUE_BRI_MAX = 254;
const HUE_HUE_MAX = 65535;
const HUE_SAT_MAX = 254;
const HUE_CT_MIN = 153;
const HUE_CT_MAX = 500;
const HUE_CT_DEFAULT = 250;
const HUE_XY_DEFAULT = [0.5, 0.5];
function coerceFiniteNumber(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.length > 0) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
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
    name: "Dimmable Light",
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
  constructor(config) {
    this.adapter = config.adapter;
    this.devices = config.devices || [];
    this.logger = config.logger;
  }
  /**
   * Get state ID from device config for a given state name
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
    this.log("debug", `Initializing device binding service with ${this.devices.length} devices`);
    for (const device of this.devices) {
      for (const stateId of this.getAllStateIds(device)) {
        this.adapter.subscribeForeignStates(stateId);
        this.log("debug", `Subscribed to state: ${stateId}`);
      }
    }
    await this.refreshStateCache();
  }
  /**
   * Refresh the state cache
   */
  async refreshStateCache() {
    for (const device of this.devices) {
      for (const stateId of this.getAllStateIds(device)) {
        try {
          const state = await this.adapter.getForeignStateAsync(stateId);
          if (state !== null && state !== void 0) {
            this.stateCache.set(stateId, state.val);
          }
        } catch (error) {
          this.log("debug", `Could not load state ${stateId}: ${error}`);
        }
      }
    }
  }
  /**
   * Update state cache when a state changes
   */
  updateStateCache(id, value) {
    this.stateCache.set(id, value);
  }
  /**
   * Get all configured lights
   */
  async getAllLights() {
    const lights = {};
    for (let i = 0; i < this.devices.length; i++) {
      const device = this.devices[i];
      const lightId = String(i + 1);
      try {
        const light = await this.getLightById(lightId);
        lights[lightId] = light;
      } catch (error) {
        this.log("warn", `Could not load device ${device.name}: ${error}`);
      }
    }
    return lights;
  }
  /**
   * Get a single light by ID
   */
  async getLightById(lightId) {
    const index = parseInt(lightId, 10) - 1;
    if (index < 0 || index >= this.devices.length) {
      throw import_errors.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
    }
    const device = this.devices[index];
    const lightTypeConfig = LIGHT_TYPES[device.lightType] || LIGHT_TYPES.color;
    const state = {
      reachable: true,
      mode: "homeautomation"
    };
    for (const stateName of lightTypeConfig.states) {
      const stateId = this.getStateId(device, stateName);
      if (stateId) {
        const value = await this.getStateValue(stateId, stateName);
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
    if (state.xy !== void 0) {
      state.colormode = "xy";
    } else if (state.ct !== void 0) {
      state.colormode = "ct";
    } else if (state.hue !== void 0 && state.sat !== void 0) {
      state.colormode = "hs";
    }
    const light = {
      state,
      name: device.name,
      type: lightTypeConfig.type,
      modelid: lightTypeConfig.modelid,
      manufacturername: "Signify Netherlands B.V.",
      productname: lightTypeConfig.name,
      uniqueid: `00:17:88:01:00:${lightId.padStart(2, "0")}:${lightId.padStart(2, "0")}:${lightId.padStart(2, "0")}-0b`,
      swversion: "1.0.0"
    };
    return light;
  }
  /**
   * Set light state
   */
  async setLightState(lightId, stateUpdate) {
    const index = parseInt(lightId, 10) - 1;
    if (index < 0 || index >= this.devices.length) {
      throw import_errors.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
    }
    const device = this.devices[index];
    const results = [];
    this.log(
      "debug",
      `Light ${lightId} "${device.name}": set ${Object.entries(stateUpdate).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}`
    );
    for (const [key, value] of Object.entries(stateUpdate)) {
      const address = `/lights/${lightId}/state/${key}`;
      const stateId = this.getStateId(device, key);
      if (!stateId) {
        this.log("debug", `No mapping for ${key} on device ${device.name}`);
        results.push({ success: { [address]: value } });
        continue;
      }
      try {
        const convertedValue = this.convertValueForState(key, value);
        await this.adapter.setForeignStateAsync(stateId, {
          val: convertedValue,
          ack: false
        });
        this.stateCache.set(stateId, convertedValue);
        results.push({ success: { [address]: value } });
        this.log("debug", `Set ${stateId} to ${convertedValue}`);
      } catch (error) {
        this.log("error", `Failed to set ${stateId}: ${error}`);
        results.push(import_errors.HueApiError.resourceNotAvailable(lightId, address).toResponse());
      }
    }
    return results;
  }
  /**
   * Get the number of configured devices
   */
  get deviceCount() {
    return this.devices.length;
  }
  /**
   * Get state value from cache or adapter
   */
  async getStateValue(stateId, stateName) {
    if (this.stateCache.has(stateId)) {
      return this.convertValueFromState(stateName, this.stateCache.get(stateId));
    }
    try {
      const state = await this.adapter.getForeignStateAsync(stateId);
      if (state !== null && state !== void 0) {
        this.stateCache.set(stateId, state.val);
        return this.convertValueFromState(stateName, state.val);
      }
    } catch (error) {
      this.log("debug", `Could not get state ${stateId}: ${error}`);
    }
    return this.getDefaultValue(stateName);
  }
  /**
   * Convert value from ioBroker state to Hue API format
   */
  convertValueFromState(stateName, value) {
    if (value === null || value === void 0) {
      return this.getDefaultValue(stateName);
    }
    switch (stateName) {
      case "on":
        if (typeof value === "string") {
          return value !== "false" && value !== "0" && value !== "";
        }
        return Boolean(value);
      case "bri": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          return HUE_BRI_MAX;
        }
        if (n <= 1) {
          return Math.round(n * HUE_BRI_MAX);
        }
        if (n <= 100) {
          return Math.max(HUE_BRI_MIN, Math.round(n / 100 * HUE_BRI_MAX));
        }
        return clampRound(n, HUE_BRI_MIN, HUE_BRI_MAX);
      }
      case "hue": {
        const n = coerceFiniteNumber(value);
        return n === null ? 0 : clampRound(n, 0, HUE_HUE_MAX);
      }
      case "sat": {
        const n = coerceFiniteNumber(value);
        if (n === null) {
          return HUE_SAT_MAX;
        }
        if (n <= 1) {
          return Math.round(n * HUE_SAT_MAX);
        }
        if (n <= 100) {
          return Math.round(n / 100 * HUE_SAT_MAX);
        }
        return clampRound(n, 0, HUE_SAT_MAX);
      }
      case "ct": {
        const n = coerceFiniteNumber(value);
        return n === null ? HUE_CT_DEFAULT : clampRound(n, HUE_CT_MIN, HUE_CT_MAX);
      }
      case "xy": {
        if (Array.isArray(value) && value.length >= 2) {
          const x = coerceFiniteNumber(value[0]);
          const y = coerceFiniteNumber(value[1]);
          if (x !== null && y !== null) {
            return [x, y];
          }
        }
        if (typeof value === "string") {
          const parts = value.split(",");
          if (parts.length >= 2) {
            const x = coerceFiniteNumber(parts[0]);
            const y = coerceFiniteNumber(parts[1]);
            if (x !== null && y !== null) {
              return [x, y];
            }
          }
        }
        return HUE_XY_DEFAULT;
      }
      default:
        return value;
    }
  }
  /**
   * Convert value from Hue API format to ioBroker state
   */
  convertValueForState(stateName, value) {
    switch (stateName) {
      case "on":
        return Boolean(value);
      case "bri": {
        const n = coerceFiniteNumber(value);
        return n === null ? HUE_BRI_MAX : clampRound(n, HUE_BRI_MIN, HUE_BRI_MAX);
      }
      case "hue": {
        const n = coerceFiniteNumber(value);
        return n === null ? 0 : clampRound(n, 0, HUE_HUE_MAX);
      }
      case "sat": {
        const n = coerceFiniteNumber(value);
        return n === null ? HUE_SAT_MAX : clampRound(n, 0, HUE_SAT_MAX);
      }
      case "ct": {
        const n = coerceFiniteNumber(value);
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
  log(level, message) {
    this.logger[level](message);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeviceBindingService
});
//# sourceMappingURL=device-binding-service.js.map
