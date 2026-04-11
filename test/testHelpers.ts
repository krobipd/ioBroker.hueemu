/**
 * Shared test helpers and mocks
 */

import type {
  DeviceBindingAdapter,
} from "../src/hue-api/device-binding-service";
import type { BridgeIdentity, Logger } from "../src/types/config";

export function createMockLogger(): Logger {
  return {
    silly: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

export function createMockDeviceBindingAdapter(
  stateValues: Record<string, unknown> = {},
): DeviceBindingAdapter & {
  writtenStates: Map<string, unknown>;
  subscribedPatterns: string[];
} {
  const writtenStates = new Map<string, unknown>();
  const subscribedPatterns: string[] = [];

  return {
    namespace: "hueemu.0",
    log: {
      silly: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as ioBroker.Logger,
    getForeignStateAsync: async (id: string) => {
      if (id in stateValues) {
        return {
          val: stateValues[id],
          ack: true,
          ts: 0,
          lc: 0,
          from: "test",
          q: 0,
        } as ioBroker.State;
      }
      return null;
    },
    setForeignStateAsync: async (id: string, state: ioBroker.SettableState) => {
      writtenStates.set(id, (state as { val: unknown }).val);
    },
    subscribeForeignStates: (pattern: string) => {
      subscribedPatterns.push(pattern);
    },
    writtenStates,
    subscribedPatterns,
  };
}

export function createTestIdentity(): BridgeIdentity {
  return {
    udn: "12345678-1234-1234-1234-123456789abc",
    mac: "AA:BB:CC:DD:EE:FF",
    bridgeId: "AABBCCFFFEEEDDEEFF",
    modelId: "BSB002",
    serialNumber: "aabbccddeeff",
  };
}
