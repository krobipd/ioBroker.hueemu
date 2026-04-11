"use strict";
/**
 * Shared test helpers and mocks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMockLogger = createMockLogger;
exports.createMockDeviceBindingAdapter = createMockDeviceBindingAdapter;
exports.createTestIdentity = createTestIdentity;
function createMockLogger() {
    return {
        silly: () => { },
        debug: () => { },
        info: () => { },
        warn: () => { },
        error: () => { },
    };
}
function createMockDeviceBindingAdapter(stateValues = {}) {
    const writtenStates = new Map();
    const subscribedPatterns = [];
    return {
        namespace: "hueemu.0",
        log: {
            silly: () => { },
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
        },
        getForeignStateAsync: async (id) => {
            if (id in stateValues) {
                return {
                    val: stateValues[id],
                    ack: true,
                    ts: 0,
                    lc: 0,
                    from: "test",
                    q: 0,
                };
            }
            return null;
        },
        setForeignStateAsync: async (id, state) => {
            writtenStates.set(id, state.val);
        },
        subscribeForeignStates: (pattern) => {
            subscribedPatterns.push(pattern);
        },
        writtenStates,
        subscribedPatterns,
    };
}
function createTestIdentity() {
    return {
        udn: "12345678-1234-1234-1234-123456789abc",
        mac: "AA:BB:CC:DD:EE:FF",
        bridgeId: "AABBCCFFFEEEDDEEFF",
        modelId: "BSB002",
        serialNumber: "aabbccddeeff",
    };
}
//# sourceMappingURL=testHelpers.js.map