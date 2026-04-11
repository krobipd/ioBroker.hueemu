"use strict";
/**
 * Device Binding Service
 * Handles binding between admin-configured devices and ioBroker states
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceBindingService = void 0;
const errors_1 = require("../types/errors");
/** Hue API value ranges (per Philips Hue API specification) */
const HUE_BRI_MIN = 1;
const HUE_BRI_MAX = 254;
const HUE_HUE_MAX = 65535;
const HUE_SAT_MAX = 254;
const HUE_CT_MIN = 153;
const HUE_CT_MAX = 500;
const HUE_CT_DEFAULT = 250;
const HUE_XY_DEFAULT = [0.5, 0.5];
/**
 * Light type definitions matching the admin UI
 */
const LIGHT_TYPES = {
    onoff: {
        name: "Dimmable light",
        type: "Dimmable light",
        states: ["on", "bri"],
        modelid: "LWB007",
    },
    dimmable: {
        name: "Dimmable Light",
        type: "Dimmable light",
        states: ["on", "bri"],
        modelid: "LWB010",
    },
    ct: {
        name: "Color Temperature Light",
        type: "Color temperature light",
        states: ["on", "bri", "ct"],
        modelid: "LTW001",
    },
    color: {
        name: "Extended Color Light",
        type: "Extended color light",
        states: ["on", "bri", "hue", "sat", "ct", "xy"],
        modelid: "LCT003",
    },
};
/**
 * Maps Hue state names to DeviceConfig property names
 */
const STATE_TO_CONFIG = {
    on: "onState",
    bri: "briState",
    ct: "ctState",
    hue: "hueState",
    sat: "satState",
    xy: "xyState",
};
/**
 * Service for managing device bindings from admin configuration
 */
class DeviceBindingService {
    adapter;
    devices;
    logger;
    stateCache = new Map();
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
        return undefined;
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
        // Subscribe to all mapped states
        for (const device of this.devices) {
            for (const stateId of this.getAllStateIds(device)) {
                this.adapter.subscribeForeignStates(stateId);
                this.log("debug", `Subscribed to state: ${stateId}`);
            }
        }
        // Pre-load current state values
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
                    if (state !== null && state !== undefined) {
                        this.stateCache.set(stateId, state.val);
                    }
                }
                catch (error) {
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
            const lightId = String(i + 1); // Use 1-based index as light ID
            try {
                const light = await this.getLightById(lightId);
                lights[lightId] = light;
            }
            catch (error) {
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
            throw errors_1.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
        }
        const device = this.devices[index];
        const lightTypeConfig = LIGHT_TYPES[device.lightType] || LIGHT_TYPES.color;
        // Build state object from mappings
        const state = {
            reachable: true,
            mode: "homeautomation",
        };
        for (const stateName of lightTypeConfig.states) {
            const stateId = this.getStateId(device, stateName);
            if (stateId) {
                const value = await this.getStateValue(stateId, stateName);
                if (value !== undefined) {
                    state[stateName] = value;
                }
            }
            else {
                // Provide default values for unmapped states
                state[stateName] =
                    this.getDefaultValue(stateName);
            }
        }
        // Ensure 'on' state exists
        if (state.on === undefined) {
            state.on = false;
        }
        // Set color mode based on available states
        if (state.xy !== undefined) {
            state.colormode = "xy";
        }
        else if (state.ct !== undefined) {
            state.colormode = "ct";
        }
        else if (state.hue !== undefined && state.sat !== undefined) {
            state.colormode = "hs";
        }
        const light = {
            state: state,
            name: device.name,
            type: lightTypeConfig.type,
            modelid: lightTypeConfig.modelid,
            manufacturername: "Signify Netherlands B.V.",
            productname: lightTypeConfig.name,
            uniqueid: `00:17:88:01:00:${lightId.padStart(2, "0")}:${lightId.padStart(2, "0")}:${lightId.padStart(2, "0")}-0b`,
            swversion: "1.0.0",
        };
        return light;
    }
    /**
     * Set light state
     */
    async setLightState(lightId, stateUpdate) {
        const index = parseInt(lightId, 10) - 1;
        if (index < 0 || index >= this.devices.length) {
            throw errors_1.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
        }
        const device = this.devices[index];
        const results = [];
        this.log("debug", `Light ${lightId} "${device.name}": set ${Object.entries(stateUpdate)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ")}`);
        for (const [key, value] of Object.entries(stateUpdate)) {
            const address = `/lights/${lightId}/state/${key}`;
            const stateId = this.getStateId(device, key);
            if (!stateId) {
                this.log("debug", `No mapping for ${key} on device ${device.name}`);
                // Still report success for unmapped states (some clients expect this)
                results.push({ success: { [address]: value } });
                continue;
            }
            try {
                const convertedValue = this.convertValueForState(key, value);
                await this.adapter.setForeignStateAsync(stateId, {
                    val: convertedValue,
                    ack: false,
                });
                this.stateCache.set(stateId, convertedValue);
                results.push({ success: { [address]: value } });
                this.log("debug", `Set ${stateId} to ${convertedValue}`);
            }
            catch (error) {
                this.log("error", `Failed to set ${stateId}: ${error}`);
                results.push(errors_1.HueApiError.resourceNotAvailable(lightId, address).toResponse());
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
        // Try cache first
        if (this.stateCache.has(stateId)) {
            return this.convertValueFromState(stateName, this.stateCache.get(stateId));
        }
        // Fetch from adapter
        try {
            const state = await this.adapter.getForeignStateAsync(stateId);
            if (state !== null && state !== undefined) {
                this.stateCache.set(stateId, state.val);
                return this.convertValueFromState(stateName, state.val);
            }
        }
        catch (error) {
            this.log("debug", `Could not get state ${stateId}: ${error}`);
        }
        return this.getDefaultValue(stateName);
    }
    /**
     * Convert value from ioBroker state to Hue API format
     */
    convertValueFromState(stateName, value) {
        if (value === null || value === undefined) {
            return this.getDefaultValue(stateName);
        }
        switch (stateName) {
            case "on":
                // Handle string "false"/"0" explicitly — Boolean("false") would be true
                if (typeof value === "string") {
                    return value !== "false" && value !== "0" && value !== "";
                }
                return Boolean(value);
            case "bri":
                // Convert percentage (0-100) to Hue brightness (1-254)
                if (typeof value === "number") {
                    if (value <= 1) {
                        // Already in 0-1 range, convert to 1-254
                        return Math.round(value * HUE_BRI_MAX);
                    }
                    else if (value <= 100) {
                        // Percentage, convert to 1-254
                        return Math.max(HUE_BRI_MIN, Math.round((value / 100) * HUE_BRI_MAX));
                    }
                    return Math.min(HUE_BRI_MAX, Math.max(HUE_BRI_MIN, Math.round(value)));
                }
                return HUE_BRI_MAX;
            case "hue":
                // Hue is 0-65535
                if (typeof value === "number") {
                    return Math.min(HUE_HUE_MAX, Math.max(0, Math.round(value)));
                }
                return 0;
            case "sat":
                // Saturation is 0-254
                if (typeof value === "number") {
                    if (value <= 1) {
                        return Math.round(value * HUE_SAT_MAX);
                    }
                    else if (value <= 100) {
                        return Math.round((value / 100) * HUE_SAT_MAX);
                    }
                    return Math.min(HUE_SAT_MAX, Math.max(0, Math.round(value)));
                }
                return HUE_SAT_MAX;
            case "ct":
                // Color temperature in mireds (153-500)
                if (typeof value === "number") {
                    return Math.min(HUE_CT_MAX, Math.max(HUE_CT_MIN, Math.round(value)));
                }
                return HUE_CT_DEFAULT;
            case "xy":
                // XY as array [x, y]
                if (Array.isArray(value) && value.length >= 2) {
                    return value.slice(0, 2);
                }
                if (typeof value === "string") {
                    const parts = value.split(",").map(Number);
                    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                        return parts.slice(0, 2);
                    }
                }
                return HUE_XY_DEFAULT;
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
            case "bri":
                return typeof value === "number"
                    ? Math.min(HUE_BRI_MAX, Math.max(HUE_BRI_MIN, value))
                    : HUE_BRI_MAX;
            case "hue":
                return typeof value === "number"
                    ? Math.min(HUE_HUE_MAX, Math.max(0, value))
                    : 0;
            case "sat":
                return typeof value === "number"
                    ? Math.min(HUE_SAT_MAX, Math.max(0, value))
                    : HUE_SAT_MAX;
            case "ct":
                return typeof value === "number"
                    ? Math.min(HUE_CT_MAX, Math.max(HUE_CT_MIN, value))
                    : HUE_CT_DEFAULT;
            case "xy":
                if (Array.isArray(value)) {
                    return JSON.stringify(value);
                }
                return String(value);
            default:
                if (typeof value === "object") {
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
    /**
     * Log a message
     */
    log(level, message) {
        if (this.logger) {
            this.logger[level](message);
        }
        else {
            this.adapter.log[level](message);
        }
    }
}
exports.DeviceBindingService = DeviceBindingService;
//# sourceMappingURL=device-binding-service.js.map