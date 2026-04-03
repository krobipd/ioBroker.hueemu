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
var light_service_exports = {};
__export(light_service_exports, {
  LightService: () => LightService
});
module.exports = __toCommonJS(light_service_exports);
var import_errors = require("../types/errors");
class LightService {
  adapter;
  logger;
  constructor(config) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }
  /**
   * Get all lights
   */
  async getAllLights() {
    this.log("debug", "Getting all lights");
    const devices = await this.getDevices();
    const lights = {};
    for (const device of devices) {
      const lightId = device._id.substring(this.adapter.namespace.length + 1);
      try {
        const light = await this.getLightById(lightId);
        lights[lightId] = light;
      } catch (error) {
        this.log("warn", `Could not load light ${lightId}: ${error}`);
      }
    }
    return lights;
  }
  /**
   * Get a single light by ID
   */
  async getLightById(lightId) {
    this.log("debug", `Getting light: ${lightId}`);
    const stateObjects = await this.getStatesOf(lightId, "state");
    if (!stateObjects || stateObjects.length === 0) {
      throw import_errors.HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
    }
    const state = {};
    for (const stateObj of stateObjects) {
      const stateId = stateObj._id.substring(this.adapter.namespace.length + 1);
      const key = stateObj._id.substring(stateObj._id.lastIndexOf(".") + 1);
      try {
        const stateValue = await this.getState(stateId);
        if (stateValue !== null && stateValue !== void 0) {
          state[key] = stateValue.val;
        }
      } catch (error) {
        this.log("debug", `Could not get state ${stateId}: ${error}`);
      }
    }
    const nameState = await this.getState(`${lightId}.name`);
    const name = (nameState == null ? void 0 : nameState.val) || lightId;
    const dataState = await this.getState(`${lightId}.data`);
    let additionalData = {};
    if (dataState == null ? void 0 : dataState.val) {
      try {
        if (typeof dataState.val === "string") {
          additionalData = JSON.parse(dataState.val);
        } else if (typeof dataState.val === "object" && dataState.val !== null) {
          additionalData = dataState.val;
        }
      } catch {
        this.log("warn", `Could not parse data for light ${lightId}`);
      }
    }
    const light = {
      state,
      name,
      type: additionalData.type || "Extended color light",
      modelid: additionalData.modelid || "LCT003",
      uniqueid: additionalData.uniqueid || `00:17:88:01:00:00:00:${lightId.padStart(2, "0")}-0b`,
      ...additionalData
    };
    return light;
  }
  /**
   * Set light state
   */
  async setLightState(lightId, stateUpdate) {
    this.log(
      "debug",
      `Setting state for light ${lightId}: ${JSON.stringify(stateUpdate)}`
    );
    const results = [];
    const stateObjects = await this.getStatesOf(lightId, "state");
    if (!stateObjects || stateObjects.length === 0) {
      throw import_errors.HueApiError.resourceNotAvailable(
        lightId,
        `/lights/${lightId}/state`
      );
    }
    const stateKeys = new Set(
      stateObjects.map((s) => s._id.substring(s._id.lastIndexOf(".") + 1))
    );
    for (const [key, value] of Object.entries(stateUpdate)) {
      const address = `/lights/${lightId}/state/${key}`;
      if (!stateKeys.has(key)) {
        this.log("warn", `Parameter ${key} not available for light ${lightId}`);
        results.push(
          import_errors.HueApiError.parameterNotAvailable(key, address).toResponse()
        );
        continue;
      }
      try {
        await this.setStateAsync(`${lightId}.state.${key}`, value);
        results.push({ success: { [address]: value } });
      } catch (error) {
        this.log(
          "error",
          `Failed to set ${key} for light ${lightId}: ${error}`
        );
        results.push(
          import_errors.HueApiError.resourceNotAvailable(lightId, address).toResponse()
        );
      }
    }
    return results;
  }
  /**
   * Get devices from the adapter
   */
  getDevices() {
    return new Promise((resolve, reject) => {
      this.adapter.getDevices((err, devices) => {
        if (err) {
          reject(err);
        } else {
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
        } else {
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
        } else {
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
      this.adapter.setState(
        id,
        { val: value, ack: true },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }
  /**
   * Log a message
   */
  log(level, message) {
    if (this.logger) {
      this.logger[level](message);
    } else {
      this.adapter.log[level](message);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LightService
});
//# sourceMappingURL=light-service.js.map
