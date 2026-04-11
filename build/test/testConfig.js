"use strict";
/**
 * Tests for config utilities and ConfigService
 */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const config_1 = require("../src/types/config");
const config_service_1 = require("../src/hue-api/config-service");
const testHelpers_1 = require("./testHelpers");
describe("Config utilities", () => {
    describe("generateBridgeId", () => {
        it("should insert FFFE in the middle of the MAC", () => {
            const result = (0, config_1.generateBridgeId)("AA:BB:CC:DD:EE:FF");
            (0, chai_1.expect)(result).to.equal("AABBCCFFFEDDEEFF");
        });
        it("should strip colons and uppercase", () => {
            const result = (0, config_1.generateBridgeId)("aa:bb:cc:dd:ee:ff");
            (0, chai_1.expect)(result).to.equal("AABBCCFFFEDDEEFF");
        });
        it("should handle MAC without colons", () => {
            const result = (0, config_1.generateBridgeId)("AABBCCDDEEFF");
            (0, chai_1.expect)(result).to.equal("AABBCCFFFEDDEEFF");
        });
    });
    describe("generateSerialNumber", () => {
        it("should strip colons and lowercase", () => {
            const result = (0, config_1.generateSerialNumber)("AA:BB:CC:DD:EE:FF");
            (0, chai_1.expect)(result).to.equal("aabbccddeeff");
        });
        it("should handle already lowercase MAC", () => {
            const result = (0, config_1.generateSerialNumber)("aa:bb:cc:dd:ee:ff");
            (0, chai_1.expect)(result).to.equal("aabbccddeeff");
        });
        it("should handle MAC without colons", () => {
            const result = (0, config_1.generateSerialNumber)("AABBCCDDEEFF");
            (0, chai_1.expect)(result).to.equal("aabbccddeeff");
        });
    });
});
describe("ConfigService", () => {
    const identity = (0, testHelpers_1.createTestIdentity)();
    let service;
    beforeEach(() => {
        service = new config_service_1.ConfigService({
            identity,
            discoveryHost: "192.168.1.100",
        });
    });
    describe("getConfig (public)", () => {
        it("should return bridge name", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.name).to.equal("Philips hue");
        });
        it("should return correct model ID", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.modelid).to.equal("BSB002");
        });
        it("should include MAC address from identity", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.mac).to.equal(identity.mac);
        });
        it("should include bridge ID from identity", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.bridgeid).to.equal(identity.bridgeId);
        });
        it("should report factorynew as false", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.factorynew).to.equal(false);
        });
        it("should have null replacesbridgeid", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.replacesbridgeid).to.be.null;
        });
        it("should include API version", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.apiversion).to.equal("1.41.0");
        });
        it("should include SW version", () => {
            const config = service.getConfig();
            (0, chai_1.expect)(config.swversion).to.equal("1941132080");
        });
    });
    describe("getFullConfig", () => {
        it("should extend public config with additional fields", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.name).to.equal("Philips hue"); // inherited from public
            (0, chai_1.expect)(full.ipaddress).to.equal("192.168.1.100");
        });
        it("should include network configuration", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.netmask).to.equal("255.255.255.0");
            (0, chai_1.expect)(full.gateway).to.equal("192.168.1.1");
            (0, chai_1.expect)(full.dhcp).to.equal(true);
        });
        it("should derive gateway from discovery host", () => {
            const svc = new config_service_1.ConfigService({
                identity,
                discoveryHost: "10.20.30.40",
            });
            const full = svc.getFullConfig();
            (0, chai_1.expect)(full.gateway).to.equal("10.20.30.1");
        });
        it("should include portal state", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.portalservices).to.equal(true);
            (0, chai_1.expect)(full.portalconnection).to.equal("connected");
            (0, chai_1.expect)(full.portalstate).to.deep.include({
                signedon: true,
                incoming: false,
                outgoing: true,
            });
        });
        it("should have zigbee channel 20", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.zigbeechannel).to.equal(20);
        });
        it("should have linkbutton false by default", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.linkbutton).to.equal(false);
        });
        it("should have empty whitelist by default", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.whitelist).to.deep.equal({});
        });
        it("should include UTC and localtime strings", () => {
            const full = service.getFullConfig();
            (0, chai_1.expect)(full.UTC).to.be.a("string");
            (0, chai_1.expect)(full.localtime).to.be.a("string");
            // Format: YYYY-MM-DD HH:MM:SS
            (0, chai_1.expect)(full.UTC).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });
    });
    describe("buildFullState", () => {
        it("should include lights in full state", () => {
            const lights = {
                1: {
                    state: { on: true, bri: 254, reachable: true },
                    name: "Test Light",
                    type: "Dimmable light",
                    modelid: "LWB010",
                    uniqueid: "00:17:88:01:00:01:01:01-0b",
                },
            };
            const state = service.buildFullState(lights);
            (0, chai_1.expect)(state.lights).to.deep.equal(lights);
        });
        it("should include empty collections for unsupported features", () => {
            const state = service.buildFullState({});
            (0, chai_1.expect)(state.groups).to.deep.equal({});
            (0, chai_1.expect)(state.schedules).to.deep.equal({});
            (0, chai_1.expect)(state.scenes).to.deep.equal({});
            (0, chai_1.expect)(state.rules).to.deep.equal({});
            (0, chai_1.expect)(state.sensors).to.deep.equal({});
            (0, chai_1.expect)(state.resourcelinks).to.deep.equal({});
        });
        it("should include full config", () => {
            const state = service.buildFullState({});
            (0, chai_1.expect)(state.config.name).to.equal("Philips hue");
            (0, chai_1.expect)(state.config.ipaddress).to.equal("192.168.1.100");
        });
    });
});
//# sourceMappingURL=testConfig.js.map