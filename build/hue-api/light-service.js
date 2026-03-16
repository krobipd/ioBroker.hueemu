"use strict";
/**
 * Light Service for Hue API
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
exports.LightService = void 0;
const errors_1 = require("../types/errors");
/**
 * Service for managing Hue lights
 */
class LightService {
    constructor(config) {
        this.adapter = config.adapter;
        this.logger = config.logger;
    }
    /**
     * Get all lights
     */
    getAllLights() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", "Getting all lights");
            const devices = yield this.getDevices();
            const lights = {};
            for (const device of devices) {
                const lightId = device._id.substring(this.adapter.namespace.length + 1);
                try {
                    const light = yield this.getLightById(lightId);
                    lights[lightId] = light;
                }
                catch (error) {
                    this.log("warn", `Could not load light ${lightId}: ${error}`);
                    // Continue with other lights
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
            this.log("debug", `Getting light: ${lightId}`);
            // Get state values
            const stateObjects = yield this.getStatesOf(lightId, "state");
            if (!stateObjects || stateObjects.length === 0) {
                throw errors_1.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
            }
            const state = {};
            for (const stateObj of stateObjects) {
                const stateId = stateObj._id.substring(this.adapter.namespace.length + 1);
                const key = stateObj._id.substring(stateObj._id.lastIndexOf(".") + 1);
                try {
                    const stateValue = yield this.getState(stateId);
                    if (stateValue !== null && stateValue !== undefined) {
                        state[key] = stateValue.val;
                    }
                }
                catch (error) {
                    this.log("debug", `Could not get state ${stateId}: ${error}`);
                }
            }
            // Get name
            const nameState = yield this.getState(`${lightId}.name`);
            const name = (nameState === null || nameState === void 0 ? void 0 : nameState.val) || lightId;
            // Get additional data
            const dataState = yield this.getState(`${lightId}.data`);
            let additionalData = {};
            if (dataState === null || dataState === void 0 ? void 0 : dataState.val) {
                try {
                    if (typeof dataState.val === "string") {
                        additionalData = JSON.parse(dataState.val);
                    }
                    else if (typeof dataState.val === "object" &&
                        dataState.val !== null) {
                        additionalData = dataState.val;
                    }
                }
                catch (_a) {
                    this.log("warn", `Could not parse data for light ${lightId}`);
                }
            }
            // Build the light object with proper type assertion
            const light = Object.assign({ state: state, name, type: additionalData.type || "Extended color light", modelid: additionalData.modelid || "LCT003", uniqueid: additionalData.uniqueid ||
                    `00:17:88:01:00:00:00:${lightId.padStart(2, "0")}-0b` }, additionalData);
            return light;
        });
    }
    /**
     * Set light state
     */
    setLightState(lightId, stateUpdate) {
        return __awaiter(this, void 0, void 0, function* () {
            this.log("debug", `Setting state for light ${lightId}: ${JSON.stringify(stateUpdate)}`);
            const results = [];
            const stateObjects = yield this.getStatesOf(lightId, "state");
            if (!stateObjects || stateObjects.length === 0) {
                throw errors_1.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}/state`);
            }
            const stateKeys = new Set(stateObjects.map((s) => s._id.substring(s._id.lastIndexOf(".") + 1)));
            for (const [key, value] of Object.entries(stateUpdate)) {
                const address = `/lights/${lightId}/state/${key}`;
                if (!stateKeys.has(key)) {
                    this.log("warn", `Parameter ${key} not available for light ${lightId}`);
                    results.push(errors_1.HueApiError.parameterNotAvailable(key, address).toResponse());
                    continue;
                }
                try {
                    yield this.setStateAsync(`${lightId}.state.${key}`, value);
                    results.push({ success: { [address]: value } });
                }
                catch (error) {
                    this.log("error", `Failed to set ${key} for light ${lightId}: ${error}`);
                    results.push(errors_1.HueApiError.resourceNotAvailable(lightId, address).toResponse());
                }
            }
            return results;
        });
    }
    /**
     * Get devices from the adapter
     */
    getDevices() {
        return new Promise((resolve, reject) => {
            this.adapter.getDevices((err, devices) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(devices || []);
                }
            });
        });
    }
    /**
     * Get states of a channel
     */
    getStatesOf(device, channel) {
        return new Promise((resolve, reject) => {
            this.adapter.getStatesOf(device, channel, (err, states) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(states || []);
                }
            });
        });
    }
    /**
     * Get a state value
     */
    getState(id) {
        return new Promise((resolve, reject) => {
            this.adapter.getState(id, (err, state) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(state);
                }
            });
        });
    }
    /**
     * Set a state value
     */
    setStateAsync(id, value) {
        return new Promise((resolve, reject) => {
            this.adapter.setState(id, { val: value, ack: true }, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
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
exports.LightService = LightService;
