/**
 * Shared test helpers and mocks
 */

import type { DeviceBindingAdapter } from "../src/hue-api/device-binding-service";
import type { BridgeIdentity, Logger } from "../src/types/config";

/** A logger that swallows everything. */
export function createMockLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/** The written parts of a state, as the stub records them. */
interface WrittenState {
  /** The value written. */
  val: unknown;
  /** The acknowledge flag written. */
  ack?: boolean;
}

/**
 * A device-binding adapter over fixed state values and object facts. Reads answer with
 * copies, like the object store; writes are recorded.
 *
 * @param stateValues The value per state id — an id listed here exists.
 * @param stateCommon The `common` per state id (min/max/unit/type/write/states).
 */
export function createMockDeviceBindingAdapter(
  stateValues: Record<string, unknown> = {},
  stateCommon: Record<string, Record<string, unknown>> = {},
): DeviceBindingAdapter & {
  /** The last value written per id. */
  writtenStates: Map<string, unknown>;
  /** The `ack` flag of the last write per id — a command to a device must go out as `ack: false`. */
  writtenAcks: Map<string, boolean | undefined>;
  /** Every pattern subscribed. */
  subscribedPatterns: string[];
} {
  const writtenStates = new Map<string, unknown>();
  const writtenAcks = new Map<string, boolean | undefined>();
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
    getForeignStateAsync: (id: string) => {
      if (id in stateValues) {
        return Promise.resolve({
          val: stateValues[id],
          ack: true,
          ts: 0,
          lc: 0,
          from: "test",
          q: 0,
        } as ioBroker.State);
      }
      return Promise.resolve(null);
    },
    getForeignObjectAsync: (id: string) => {
      // Treat a configured value (or a declared `common`) as "object exists";
      // unknown ids = missing object. `stateCommon` lets a test give a source
      // the min/max/unit the runtime scale resolution reads (v1.17.0).
      if (id in stateValues || id in stateCommon) {
        // A copy, like the object store hands out — code that mutates what it read must not
        // change what the next read returns.
        return Promise.resolve(
          structuredClone({
            _id: id,
            type: "state",
            common: stateCommon[id] ?? {},
            native: {},
          }) as unknown as ioBroker.Object,
        );
      }
      return Promise.resolve(null);
    },
    setForeignStateAsync: (id: string, state: ioBroker.SettableState) => {
      writtenStates.set(id, (state as WrittenState).val);
      writtenAcks.set(id, (state as WrittenState).ack);
      return Promise.resolve();
    },
    subscribeForeignStates: (pattern: string) => {
      subscribedPatterns.push(pattern);
    },
    writtenStates,
    writtenAcks,
    subscribedPatterns,
  };
}

/** A fixed bridge identity. */
export function createTestIdentity(): BridgeIdentity {
  return {
    udn: "12345678-1234-1234-1234-123456789abc",
    mac: "AA:BB:CC:DD:EE:FF",
    bridgeId: "AABBCCFFFEEEDDEEFF",
    modelId: "BSB002",
    serialNumber: "aabbccddeeff",
  };
}
