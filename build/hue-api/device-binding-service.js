"use strict";
/**
 * Device Binding Service
 * Handles binding between admin-configured devices and ioBroker states
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceBindingService = void 0;
const errors_1 = require("../types/errors");
/**
 * Light type definitions matching the admin UI
 */
const LIGHT_TYPES = {
    onoff: {
        name: "On/Off Light",
        type: "On/Off light",
        states: ["on"],
        modelid: "LOM001",
        capabilities: { control: {}, streaming: { renderer: false, proxy: false } },
    },
    dimmable: {
        name: "Dimmable Light",
        type: "Dimmable light",
        states: ["on", "bri"],
        modelid: "LWB010",
        capabilities: {
            control: { mindimlevel: 1, maxlumen: 800 },
            streaming: { renderer: false, proxy: false },
        },
    },
    ct: {
        name: "Color Temperature Light",
        type: "Color temperature light",
        states: ["on", "bri", "ct"],
        modelid: "LTW001",
        capabilities: {
            control: { mindimlevel: 1, maxlumen: 800, ct: { min: 153, max: 500 } },
            streaming: { renderer: false, proxy: false },
        },
    },
    color: {
        name: "Extended Color Light",
        type: "Extended color light",
        states: ["on", "bri", "hue", "sat", "ct", "xy"],
        modelid: "LCT003",
        capabilities: {
            control: {
                mindimlevel: 1,
                maxlumen: 800,
                colorgamuttype: "C",
                colorgamut: [
                    [0.6915, 0.3083],
                    [0.17, 0.7],
                    [0.1532, 0.0475],
                ],
                ct: { min: 153, max: 500 },
            },
            streaming: { renderer: false, proxy: false },
        },
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
    constructor(config) {
        this.stateCache = new Map();
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
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("info", `Initializing device binding service with ${this.devices.length} devices`);
            // Subscribe to all mapped states
            for (const device of this.devices) {
                for (const stateId of this.getAllStateIds(device)) {
                    this.adapter.subscribeForeignStates(stateId);
                    this.log("debug", `Subscribed to state: ${stateId}`);
                }
            }
            // Pre-load current state values
            yield this.refreshStateCache();
        });
    }
    /**
     * Refresh the state cache
     */
    refreshStateCache() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const device of this.devices) {
                for (const stateId of this.getAllStateIds(device)) {
                    try {
                        const state = yield this.adapter.getForeignStateAsync(stateId);
                        if (state !== null && state !== undefined) {
                            this.stateCache.set(stateId, state.val);
                        }
                    }
                    catch (error) {
                        this.log("debug", `Could not load state ${stateId}: ${error}`);
                    }
                }
            }
        });
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
    getAllLights() {
        return __awaiter(this, void 0, void 0, function* () {
            const lights = {};
            for (let i = 0; i < this.devices.length; i++) {
                const device = this.devices[i];
                const lightId = String(i + 1); // Use 1-based index as light ID
                try {
                    const light = yield this.getLightById(lightId);
                    lights[lightId] = light;
                }
                catch (error) {
                    this.log("warn", `Could not load device ${device.name}: ${error}`);
                }
            }
            return lights;
        });
    }
    /**
     * Get a single light by ID
     */
    getLightById(lightId) {
        return __awaiter(this, void 0, void 0, function* () {
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
                    const value = yield this.getStateValue(stateId, stateName);
                    if (value !== undefined) {
                        state[stateName] = value;
                    }
                }
                else {
                    // Provide default values for unmapped states
                    state[stateName] = this.getDefaultValue(stateName);
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
                capabilities: Object.assign({ certified: false }, lightTypeConfig.capabilities),
            };
            return light;
        });
    }
    /**
     * Set light state
     */
    setLightState(lightId, stateUpdate) {
        return __awaiter(this, void 0, void 0, function* () {
            const index = parseInt(lightId, 10) - 1;
            if (index < 0 || index >= this.devices.length) {
                throw errors_1.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
            }
            const device = this.devices[index];
            const results = [];
            this.log("info", `Light ${lightId} "${device.name}": set ${Object.entries(stateUpdate)
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
                    yield this.adapter.setForeignStateAsync(stateId, {
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
        });
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
    getStateValue(stateId, stateName) {
        return __awaiter(this, void 0, void 0, function* () {
            // Try cache first
            if (this.stateCache.has(stateId)) {
                return this.convertValueFromState(stateName, this.stateCache.get(stateId));
            }
            // Fetch from adapter
            try {
                const state = yield this.adapter.getForeignStateAsync(stateId);
                if (state !== null && state !== undefined) {
                    this.stateCache.set(stateId, state.val);
                    return this.convertValueFromState(stateName, state.val);
                }
            }
            catch (error) {
                this.log("debug", `Could not get state ${stateId}: ${error}`);
            }
            return this.getDefaultValue(stateName);
        });
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
                return Boolean(value);
            case "bri":
                // Convert percentage (0-100) to Hue brightness (1-254)
                if (typeof value === "number") {
                    if (value <= 1) {
                        // Already in 0-1 range, convert to 1-254
                        return Math.round(value * 254);
                    }
                    else if (value <= 100) {
                        // Percentage, convert to 1-254
                        return Math.max(1, Math.round((value / 100) * 254));
                    }
                    return Math.min(254, Math.max(1, Math.round(value)));
                }
                return 254;
            case "hue":
                // Hue is 0-65535
                if (typeof value === "number") {
                    return Math.min(65535, Math.max(0, Math.round(value)));
                }
                return 0;
            case "sat":
                // Saturation is 0-254
                if (typeof value === "number") {
                    if (value <= 1) {
                        return Math.round(value * 254);
                    }
                    else if (value <= 100) {
                        return Math.round((value / 100) * 254);
                    }
                    return Math.min(254, Math.max(0, Math.round(value)));
                }
                return 254;
            case "ct":
                // Color temperature in mireds (153-500)
                if (typeof value === "number") {
                    return Math.min(500, Math.max(153, Math.round(value)));
                }
                return 250;
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
                return [0.5, 0.5];
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
                // Keep as 1-254 for now
                return typeof value === "number"
                    ? Math.min(254, Math.max(1, value))
                    : 254;
            case "hue":
                return typeof value === "number"
                    ? Math.min(65535, Math.max(0, value))
                    : 0;
            case "sat":
                return typeof value === "number"
                    ? Math.min(254, Math.max(0, value))
                    : 254;
            case "ct":
                return typeof value === "number"
                    ? Math.min(500, Math.max(153, value))
                    : 250;
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
                return 254;
            case "hue":
                return 0;
            case "sat":
                return 254;
            case "ct":
                return 250;
            case "xy":
                return [0.5, 0.5];
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
