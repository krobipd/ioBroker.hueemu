/**
 * Light Service for Hue API
 */

import type { Logger } from "../types/config";
import type {
  Light,
  LightsCollection,
  LightStateUpdate,
  LightStateResult,
} from "../types/light";
import { HueApiError } from "../types/errors";

/**
 * Adapter interface for light service
 */
export interface LightServiceAdapter {
  /**
   *
   */
  namespace: string;
  log: ioBroker.Logger;
  /**
   *
   */
  getDevices(
    callback: ioBroker.GetObjectsCallback3<ioBroker.DeviceObject>,
  ): void;
  /**
   *
   */
  getStatesOf(
    parentDevice: string | undefined,
    parentChannel: string | undefined,
    callback: ioBroker.GetObjectsCallback3<ioBroker.StateObject>,
  ): void;
  getState(id: string, callback: ioBroker.GetStateCallback): void;
  /**
   *
   */
  setState(
    id: string,
    state: ioBroker.SettableState,
    callback?: ioBroker.SetStateCallback,
  ): void;
}

/**
 * Light service configuration
 */
export interface LightServiceConfig {
  /** Adapter instance */
  adapter: LightServiceAdapter;
  /** Optional logger */
  logger?: Logger;
}

/**
 * Service for managing Hue lights
 */
export class LightService {
  private readonly adapter: LightServiceAdapter;
  private readonly logger?: Logger;

  constructor(config: LightServiceConfig) {
    this.adapter = config.adapter;
    this.logger = config.logger;
  }

  /**
   * Get all lights
   */
  public async getAllLights(): Promise<LightsCollection> {
    this.log("debug", "Getting all lights");

    const devices = await this.getDevices();
    const lights: LightsCollection = {};

    for (const device of devices) {
      const lightId = device._id.substring(this.adapter.namespace.length + 1);
      try {
        const light = await this.getLightById(lightId);
        lights[lightId] = light;
      } catch (error) {
        this.log("warn", `Could not load light ${lightId}: ${error}`);
        // Continue with other lights
      }
    }

    return lights;
  }

  /**
   * Get a single light by ID
   */
  public async getLightById(lightId: string): Promise<Light> {
    this.log("debug", `Getting light: ${lightId}`);

    // Get state values
    const stateObjects = await this.getStatesOf(lightId, "state");

    if (!stateObjects || stateObjects.length === 0) {
      throw HueApiError.resourceNotAvailable(lightId, `/lights/${lightId}`);
    }

    const state: Record<string, unknown> = {};

    for (const stateObj of stateObjects) {
      const stateId = stateObj._id.substring(this.adapter.namespace.length + 1);
      const key = stateObj._id.substring(stateObj._id.lastIndexOf(".") + 1);

      try {
        const stateValue = await this.getState(stateId);
        if (stateValue !== null && stateValue !== undefined) {
          state[key] = stateValue.val;
        }
      } catch (error) {
        this.log("debug", `Could not get state ${stateId}: ${error}`);
      }
    }

    // Get name
    const nameState = await this.getState(`${lightId}.name`);
    const name = (nameState?.val as string) || lightId;

    // Get additional data
    const dataState = await this.getState(`${lightId}.data`);
    let additionalData: Record<string, unknown> = {};

    if (dataState?.val) {
      try {
        if (typeof dataState.val === "string") {
          additionalData = JSON.parse(dataState.val);
        } else if (
          typeof dataState.val === "object" &&
          dataState.val !== null
        ) {
          additionalData = dataState.val as Record<string, unknown>;
        }
      } catch {
        this.log("warn", `Could not parse data for light ${lightId}`);
      }
    }

    // Build the light object with proper type assertion
    const light: Light = {
      state: state as unknown as Light["state"],
      name,
      type: (additionalData.type as Light["type"]) || "Extended color light",
      modelid: (additionalData.modelid as string) || "LCT003",
      uniqueid:
        (additionalData.uniqueid as string) ||
        `00:17:88:01:00:00:00:${lightId.padStart(2, "0")}-0b`,
      ...additionalData,
    };

    return light;
  }

  /**
   * Set light state
   */
  public async setLightState(
    lightId: string,
    stateUpdate: LightStateUpdate,
  ): Promise<LightStateResult[]> {
    this.log(
      "debug",
      `Setting state for light ${lightId}: ${JSON.stringify(stateUpdate)}`,
    );

    const results: LightStateResult[] = [];
    const stateObjects = await this.getStatesOf(lightId, "state");

    if (!stateObjects || stateObjects.length === 0) {
      throw HueApiError.resourceNotAvailable(
        lightId,
        `/lights/${lightId}/state`,
      );
    }

    const stateKeys = new Set(
      stateObjects.map((s) => s._id.substring(s._id.lastIndexOf(".") + 1)),
    );

    for (const [key, value] of Object.entries(stateUpdate)) {
      const address = `/lights/${lightId}/state/${key}`;

      if (!stateKeys.has(key)) {
        this.log("warn", `Parameter ${key} not available for light ${lightId}`);
        results.push(
          HueApiError.parameterNotAvailable(key, address).toResponse(),
        );
        continue;
      }

      try {
        await this.setStateAsync(`${lightId}.state.${key}`, value);
        results.push({ success: { [address]: value } });
      } catch (error) {
        this.log(
          "error",
          `Failed to set ${key} for light ${lightId}: ${error}`,
        );
        results.push(
          HueApiError.resourceNotAvailable(lightId, address).toResponse(),
        );
      }
    }

    return results;
  }

  /**
   * Get devices from the adapter
   */
  private getDevices(): Promise<ioBroker.DeviceObject[]> {
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
  private getStatesOf(
    device: string,
    channel: string,
  ): Promise<ioBroker.StateObject[]> {
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
  private getState(id: string): Promise<ioBroker.State | null | undefined> {
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
  private setStateAsync(id: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.adapter.setState(
        id,
        { val: value as ioBroker.StateValue, ack: true },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }

  /**
   * Log a message
   */
  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    if (this.logger) {
      this.logger[level](message);
    } else {
      this.adapter.log[level](message);
    }
  }
}
