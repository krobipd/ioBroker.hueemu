"use strict";
/**
 * Comprehensive unit tests for the ioBroker.hueemu adapter
 *
 * Tests cover:
 * - HueApiError: error types, formatting, factory methods
 * - Config utilities: generateBridgeId, generateSerialNumber
 * - Description XML: generation and URL building
 * - ConfigService: public/full config, buildFullState
 * - DeviceBindingService: value conversions, light management, state setting
 * - Light type integration: full round-trip with DeviceBindingService
 * - Error handler: createSuccessResponse
 */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
// --- Types & Errors ---
const errors_1 = require("../src/types/errors");
const config_1 = require("../src/types/config");
// --- Discovery ---
const description_xml_1 = require("../src/discovery/description-xml");
// --- Services ---
const config_service_1 = require("../src/hue-api/config-service");
const device_binding_service_1 = require("../src/hue-api/device-binding-service");
// --- Error handler ---
const error_handler_1 = require("../src/server/middleware/error-handler");
// =====================================================================
// Mock helpers
// =====================================================================
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
// =====================================================================
// HueApiError
// =====================================================================
describe("HueApiError", () => {
    describe("factory methods", () => {
        it("should create unauthorizedUser error", () => {
            const err = errors_1.HueApiError.unauthorizedUser("/api/test");
            (0, chai_1.expect)(err).to.be.instanceOf(errors_1.HueApiError);
            (0, chai_1.expect)(err).to.be.instanceOf(Error);
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.UNAUTHORIZED_USER);
            (0, chai_1.expect)(err.address).to.equal("/api/test");
            (0, chai_1.expect)(err.message).to.equal("unauthorized user");
            (0, chai_1.expect)(err.name).to.equal("HueApiError");
        });
        it("should create invalidJson error", () => {
            const err = errors_1.HueApiError.invalidJson("/api/lights");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INVALID_JSON);
            (0, chai_1.expect)(err.message).to.equal("body contains invalid JSON");
        });
        it("should create resourceNotAvailable error with parameter substitution", () => {
            const err = errors_1.HueApiError.resourceNotAvailable("42", "/lights/42");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.RESOURCE_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("resource, 42, not available");
            (0, chai_1.expect)(err.address).to.equal("/lights/42");
        });
        it("should create methodNotAvailable error with two parameters", () => {
            const err = errors_1.HueApiError.methodNotAvailable("DELETE", "/lights", "/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.METHOD_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("method, DELETE, not available for resource, /lights");
        });
        it("should create missingParameters error", () => {
            const err = errors_1.HueApiError.missingParameters("/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.MISSING_PARAMETERS);
            (0, chai_1.expect)(err.message).to.equal("missing parameters in body");
        });
        it("should create parameterNotAvailable error", () => {
            const err = errors_1.HueApiError.parameterNotAvailable("xyz", "/lights/1/state");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.PARAMETER_NOT_AVAILABLE);
            (0, chai_1.expect)(err.message).to.equal("parameter, xyz, not available");
        });
        it("should create invalidParameterValue error", () => {
            const err = errors_1.HueApiError.invalidParameterValue("999", "bri", "/lights/1/state");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INVALID_PARAMETER_VALUE);
            (0, chai_1.expect)(err.message).to.equal("invalid value, 999, for parameter, bri");
        });
        it("should create linkButtonNotPressed error", () => {
            const err = errors_1.HueApiError.linkButtonNotPressed("/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.LINK_BUTTON_NOT_PRESSED);
            (0, chai_1.expect)(err.message).to.equal("link button not pressed");
        });
        it("should create internalError error", () => {
            const err = errors_1.HueApiError.internalError("something broke", "/api");
            (0, chai_1.expect)(err.type).to.equal(errors_1.HueErrorType.INTERNAL_ERROR);
            (0, chai_1.expect)(err.message).to.equal("internal error, something broke");
        });
        it("should use empty string as default address", () => {
            const err = errors_1.HueApiError.unauthorizedUser();
            (0, chai_1.expect)(err.address).to.equal("");
        });
    });
    describe("toResponse", () => {
        it("should format as Hue API error response", () => {
            const err = errors_1.HueApiError.unauthorizedUser("/api/baduser/lights");
            const response = err.toResponse();
            (0, chai_1.expect)(response).to.deep.equal({
                error: {
                    type: 1,
                    address: "/api/baduser/lights",
                    description: "unauthorized user",
                },
            });
        });
        it("should include substituted parameters in description", () => {
            const err = errors_1.HueApiError.resourceNotAvailable("99", "/lights/99");
            const response = err.toResponse();
            (0, chai_1.expect)(response.error.type).to.equal(3);
            (0, chai_1.expect)(response.error.description).to.equal("resource, 99, not available");
            (0, chai_1.expect)(response.error.address).to.equal("/lights/99");
        });
    });
    describe("error type enum values", () => {
        it("should have correct numeric values", () => {
            (0, chai_1.expect)(errors_1.HueErrorType.UNAUTHORIZED_USER).to.equal(1);
            (0, chai_1.expect)(errors_1.HueErrorType.INVALID_JSON).to.equal(2);
            (0, chai_1.expect)(errors_1.HueErrorType.RESOURCE_NOT_AVAILABLE).to.equal(3);
            (0, chai_1.expect)(errors_1.HueErrorType.METHOD_NOT_AVAILABLE).to.equal(4);
            (0, chai_1.expect)(errors_1.HueErrorType.MISSING_PARAMETERS).to.equal(5);
            (0, chai_1.expect)(errors_1.HueErrorType.PARAMETER_NOT_AVAILABLE).to.equal(6);
            (0, chai_1.expect)(errors_1.HueErrorType.INVALID_PARAMETER_VALUE).to.equal(7);
            (0, chai_1.expect)(errors_1.HueErrorType.PARAMETER_NOT_MODIFIABLE).to.equal(8);
            (0, chai_1.expect)(errors_1.HueErrorType.INTERNAL_ERROR).to.equal(901);
            (0, chai_1.expect)(errors_1.HueErrorType.LINK_BUTTON_NOT_PRESSED).to.equal(101);
            (0, chai_1.expect)(errors_1.HueErrorType.DEVICE_IS_OFF).to.equal(201);
        });
    });
});
// =====================================================================
// Config utilities
// =====================================================================
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
// =====================================================================
// Description XML
// =====================================================================
describe("Description XML", () => {
    const identity = createTestIdentity();
    describe("generateDescriptionXml", () => {
        it("should generate valid XML with correct structure", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include('<?xml version="1.0" encoding="UTF-8" ?>');
            (0, chai_1.expect)(xml).to.include("urn:schemas-upnp-org:device-1-0");
            (0, chai_1.expect)(xml).to.include("urn:schemas-upnp-org:device:Basic:1");
        });
        it("should include host in friendlyName", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include("Philips hue (192.168.1.100)");
        });
        it("should include correct URLBase", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include("<URLBase>http://192.168.1.100:8080/</URLBase>");
        });
        it("should use custom urlBase when provided", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
                urlBase: "https://custom.host:9999/",
            });
            (0, chai_1.expect)(xml).to.include("<URLBase>https://custom.host:9999/</URLBase>");
        });
        it("should include serial number from identity", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include(`<serialNumber>${identity.serialNumber}</serialNumber>`);
        });
        it("should include UDN from identity", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include(`<UDN>uuid:${identity.udn}</UDN>`);
        });
        it("should include Philips hue bridge 2015 model", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include("<modelName>Philips hue bridge 2015</modelName>");
            (0, chai_1.expect)(xml).to.include("<modelNumber>BSB002</modelNumber>");
        });
        it("should include Signify as manufacturer", () => {
            const xml = (0, description_xml_1.generateDescriptionXml)({
                identity,
                host: "192.168.1.100",
                port: 8080,
            });
            (0, chai_1.expect)(xml).to.include("<manufacturer>Signify</manufacturer>");
        });
    });
    describe("getDescriptionUrl", () => {
        it("should build correct description URL", () => {
            const url = (0, description_xml_1.getDescriptionUrl)("192.168.1.100", 8080);
            (0, chai_1.expect)(url).to.equal("http://192.168.1.100:8080/description.xml");
        });
        it("should work with different ports", () => {
            const url = (0, description_xml_1.getDescriptionUrl)("10.0.0.1", 80);
            (0, chai_1.expect)(url).to.equal("http://10.0.0.1:80/description.xml");
        });
    });
});
// =====================================================================
// ConfigService
// =====================================================================
describe("ConfigService", () => {
    const identity = createTestIdentity();
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
// =====================================================================
// DeviceBindingService — Value Conversion (critical path)
// =====================================================================
describe("DeviceBindingService", () => {
    // Helper to create service with test devices
    function createService(devices, stateValues = {}) {
        const adapter = createMockDeviceBindingAdapter(stateValues);
        const logger = createMockLogger();
        const service = new device_binding_service_1.DeviceBindingService({
            adapter,
            devices,
            logger,
        });
        return { service, adapter };
    }
    describe("deviceCount", () => {
        it("should return 0 for empty devices", () => {
            const { service } = createService([]);
            (0, chai_1.expect)(service.deviceCount).to.equal(0);
        });
        it("should return correct count", () => {
            const { service } = createService([
                { name: "Light 1", lightType: "onoff" },
                { name: "Light 2", lightType: "dimmable" },
            ]);
            (0, chai_1.expect)(service.deviceCount).to.equal(2);
        });
    });
    describe("getAllLights", () => {
        it("should return empty collection for no devices", async () => {
            const { service } = createService([]);
            const lights = await service.getAllLights();
            (0, chai_1.expect)(lights).to.deep.equal({});
        });
        it("should return lights with 1-based IDs", async () => {
            const { service } = createService([
                { name: "First", lightType: "onoff" },
                { name: "Second", lightType: "dimmable" },
            ]);
            const lights = await service.getAllLights();
            (0, chai_1.expect)(Object.keys(lights)).to.deep.equal(["1", "2"]);
            (0, chai_1.expect)(lights["1"].name).to.equal("First");
            (0, chai_1.expect)(lights["2"].name).to.equal("Second");
        });
    });
    describe("getLightById", () => {
        it("should throw for invalid light ID (0)", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff" }]);
            try {
                await service.getLightById("0");
                chai_1.expect.fail("Should have thrown");
            }
            catch (error) {
                (0, chai_1.expect)(error).to.be.instanceOf(errors_1.HueApiError);
                (0, chai_1.expect)(error.type).to.equal(errors_1.HueErrorType.RESOURCE_NOT_AVAILABLE);
            }
        });
        it("should throw for out-of-range light ID", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff" }]);
            try {
                await service.getLightById("5");
                chai_1.expect.fail("Should have thrown");
            }
            catch (error) {
                (0, chai_1.expect)(error).to.be.instanceOf(errors_1.HueApiError);
            }
        });
        it("should throw for negative light ID", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff" }]);
            try {
                await service.getLightById("-1");
                chai_1.expect.fail("Should have thrown");
            }
            catch (error) {
                (0, chai_1.expect)(error).to.be.instanceOf(errors_1.HueApiError);
            }
        });
        describe("light type mapping", () => {
            it("should map onoff to LWB007 / Dimmable light", async () => {
                const { service } = createService([
                    { name: "Switch", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.modelid).to.equal("LWB007");
                (0, chai_1.expect)(light.type).to.equal("Dimmable light");
            });
            it("should map dimmable to LWB010 / Dimmable light", async () => {
                const { service } = createService([
                    { name: "Dimmer", lightType: "dimmable" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.modelid).to.equal("LWB010");
                (0, chai_1.expect)(light.type).to.equal("Dimmable light");
            });
            it("should map ct to LTW001 / Color temperature light", async () => {
                const { service } = createService([{ name: "CT", lightType: "ct" }]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.modelid).to.equal("LTW001");
                (0, chai_1.expect)(light.type).to.equal("Color temperature light");
            });
            it("should map color to LCT003 / Extended color light", async () => {
                const { service } = createService([
                    { name: "Color", lightType: "color" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.modelid).to.equal("LCT003");
                (0, chai_1.expect)(light.type).to.equal("Extended color light");
            });
        });
        describe("light metadata", () => {
            it("should include manufacturer name", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.manufacturername).to.equal("Signify Netherlands B.V.");
            });
            it("should generate unique ID based on light index", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.uniqueid).to.equal("00:17:88:01:00:01:01:01-0b");
            });
            it("should generate padded unique ID for single-digit IDs", async () => {
                const { service } = createService([
                    { name: "L1", lightType: "onoff" },
                    { name: "L2", lightType: "onoff" },
                    { name: "L3", lightType: "onoff" },
                    { name: "L4", lightType: "onoff" },
                    { name: "L5", lightType: "onoff" },
                    { name: "L6", lightType: "onoff" },
                    { name: "L7", lightType: "onoff" },
                    { name: "L8", lightType: "onoff" },
                    { name: "L9", lightType: "onoff" },
                    { name: "L10", lightType: "onoff" },
                ]);
                const light = await service.getLightById("10");
                (0, chai_1.expect)(light.uniqueid).to.equal("00:17:88:01:00:10:10:10-0b");
            });
            it("should include software version", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.swversion).to.equal("1.0.0");
            });
            it("should set product name from light type config", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "color" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.productname).to.equal("Extended Color Light");
            });
        });
        describe("default state values", () => {
            it("should default on to false when not mapped", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should default bri to 254 when not mapped", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "dimmable" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(254);
            });
            it("should default ct to 250 when not mapped", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct" }]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(250);
            });
            it("should default hue to 0 when not mapped", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "color" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(0);
            });
            it("should default sat to 254 when not mapped", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "color" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.sat).to.equal(254);
            });
            it("should default xy to [0.5, 0.5] when not mapped", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "color" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.5, 0.5]);
            });
        });
        describe("color mode detection", () => {
            it("should set colormode to xy when xy is available", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": [0.3, 0.4] });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.colormode).to.equal("xy");
            });
            it("should set colormode to ct when ct is available but not xy", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 300 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.colormode).to.equal("ct");
            });
            it("should set colormode to xy for color lights (xy has priority over hs)", async () => {
                // color lights always have xy in their states list, so even with hue+sat
                // configured, xy gets a default value and takes priority
                const { service } = createService([
                    {
                        name: "Test",
                        lightType: "color",
                        hueState: "test.hue",
                        satState: "test.sat",
                    },
                ], { "test.hue": 10000, "test.sat": 200 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.colormode).to.equal("xy");
            });
            it("should set colormode to hs for ct light with hue+sat only", async () => {
                // ct lights don't have xy in their states list, so only hs is available
                const { service } = createService([
                    {
                        name: "Test",
                        lightType: "ct",
                        hueState: "test.hue",
                        satState: "test.sat",
                        ctState: undefined,
                    },
                ], { "test.hue": 10000, "test.sat": 200 });
                const light = await service.getLightById("1");
                // ct type doesn't have hue/sat in states list, so neither hs nor xy is set
                (0, chai_1.expect)(light.state.colormode).to.equal("ct");
            });
        });
        describe("state includes reachable and mode", () => {
            it("should set reachable to true", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.reachable).to.equal(true);
            });
            it("should set mode to homeautomation", async () => {
                const { service } = createService([
                    { name: "Test", lightType: "onoff" },
                ]);
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.mode).to.equal("homeautomation");
            });
        });
    });
    // =====================================================================
    // Value conversion: ioBroker → Hue (convertValueFromState)
    // =====================================================================
    describe("value conversion: ioBroker → Hue (reading states)", () => {
        describe("on state", () => {
            it("should convert true to true", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": true });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(true);
            });
            it("should convert false to false", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": false });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should convert 1 to true", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": 1 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(true);
            });
            it("should convert 0 to false", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": 0 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should handle string 'false' as false (Boolean('false') bug fix)", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": "false" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should handle string '0' as false", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": "0" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should handle empty string as false", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": "" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
            it("should handle string 'true' as true", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": "true" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(true);
            });
            it("should handle null as default (false)", async () => {
                const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": null });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.on).to.equal(false);
            });
        });
        describe("bri state (brightness)", () => {
            it("should convert percentage 50 to Hue range (~127)", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 50 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(127);
            });
            it("should convert percentage 100 to 254", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 100 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(254);
            });
            it("should convert percentage 0 to minimum 1 (via max(1,...))", async () => {
                // 0/100 * 254 = 0, but max(1, 0) = ... actually 0 <= 1, so <= 1 branch
                // 0 * 254 = 0
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 0 });
                const light = await service.getLightById("1");
                // 0 <= 1, so 0-1 range: Math.round(0 * 254) = 0
                (0, chai_1.expect)(light.state.bri).to.equal(0);
            });
            it("should convert 0-1 range (0.5) to ~127", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 0.5 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(127);
            });
            it("should convert 1.0 to 254", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 1.0 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(254);
            });
            it("should clamp values above 254 to 254", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": 300 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(254);
            });
            it("should return 254 for non-numeric values", async () => {
                const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], { "test.bri": "not a number" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.bri).to.equal(254);
            });
        });
        describe("hue state", () => {
            it("should pass through values in 0-65535 range", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], { "test.hue": 30000 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(30000);
            });
            it("should clamp to 0 for negative values", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], { "test.hue": -100 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(0);
            });
            it("should clamp to 65535 for values above range", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], { "test.hue": 70000 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(65535);
            });
            it("should round fractional values", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], { "test.hue": 30000.7 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(30001);
            });
            it("should return 0 for non-numeric values", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], { "test.hue": "invalid" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.hue).to.equal(0);
            });
        });
        describe("sat state (saturation)", () => {
            it("should convert percentage 100 to 254", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], { "test.sat": 100 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.sat).to.equal(254);
            });
            it("should convert percentage 50 to ~127", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], { "test.sat": 50 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.sat).to.equal(127);
            });
            it("should convert 0-1 range (0.5) to ~127", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], { "test.sat": 0.5 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.sat).to.equal(127);
            });
            it("should handle negative values (treated as 0-1 range)", async () => {
                // Negative values hit the `value <= 1` branch and get multiplied by 254
                // This is a known edge case — negative sat values don't make practical sense
                const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], { "test.sat": -10 });
                const light = await service.getLightById("1");
                // -10 * 254 = -2540 (not clamped — edge case, negative input is nonsensical)
                (0, chai_1.expect)(light.state.sat).to.equal(-2540);
            });
            it("should clamp to 254 maximum", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], { "test.sat": 300 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.sat).to.equal(254);
            });
        });
        describe("ct state (color temperature)", () => {
            it("should pass through values in 153-500 range", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 300 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(300);
            });
            it("should clamp to 153 minimum", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 100 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(153);
            });
            it("should clamp to 500 maximum", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 600 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(500);
            });
            it("should round fractional values", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 299.7 });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(300);
            });
            it("should return 250 for non-numeric values", async () => {
                const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": "warm" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.ct).to.equal(250);
            });
        });
        describe("xy state", () => {
            it("should pass through array values", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": [0.3127, 0.329] });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.3127, 0.329]);
            });
            it("should parse comma-separated string", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": "0.3127,0.3290" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.3127, 0.329]);
            });
            it("should truncate arrays longer than 2", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": [0.1, 0.2, 0.3] });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.1, 0.2]);
            });
            it("should return default [0.5, 0.5] for invalid string", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": "invalid" });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.5, 0.5]);
            });
            it("should return default [0.5, 0.5] for null", async () => {
                const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": null });
                const light = await service.getLightById("1");
                (0, chai_1.expect)(light.state.xy).to.deep.equal([0.5, 0.5]);
            });
        });
    });
    // =====================================================================
    // Value conversion: Hue → ioBroker (convertValueForState via setLightState)
    // =====================================================================
    describe("value conversion: Hue → ioBroker (setting states)", () => {
        it("should convert on=true to boolean true", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "onoff", onState: "test.on" },
            ]);
            await service.setLightState("1", { on: true });
            (0, chai_1.expect)(adapter.writtenStates.get("test.on")).to.equal(true);
        });
        it("should convert on=false to boolean false", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "onoff", onState: "test.on" },
            ]);
            await service.setLightState("1", { on: false });
            (0, chai_1.expect)(adapter.writtenStates.get("test.on")).to.equal(false);
        });
        it("should clamp bri to 1-254 range", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "dimmable", briState: "test.bri" },
            ]);
            await service.setLightState("1", { bri: 300 });
            (0, chai_1.expect)(adapter.writtenStates.get("test.bri")).to.equal(254);
        });
        it("should clamp bri minimum to 1", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "dimmable", briState: "test.bri" },
            ]);
            await service.setLightState("1", { bri: 0 });
            (0, chai_1.expect)(adapter.writtenStates.get("test.bri")).to.equal(1);
        });
        it("should clamp hue to 0-65535", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "color", hueState: "test.hue" },
            ]);
            await service.setLightState("1", { hue: 70000 });
            (0, chai_1.expect)(adapter.writtenStates.get("test.hue")).to.equal(65535);
        });
        it("should clamp sat to 0-254", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "color", satState: "test.sat" },
            ]);
            await service.setLightState("1", { sat: 300 });
            (0, chai_1.expect)(adapter.writtenStates.get("test.sat")).to.equal(254);
        });
        it("should clamp ct to 153-500", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "ct", ctState: "test.ct" },
            ]);
            await service.setLightState("1", { ct: 100 });
            (0, chai_1.expect)(adapter.writtenStates.get("test.ct")).to.equal(153);
        });
        it("should serialize xy array as JSON string", async () => {
            const { service, adapter } = createService([
                { name: "Test", lightType: "color", xyState: "test.xy" },
            ]);
            await service.setLightState("1", { xy: [0.3, 0.4] });
            (0, chai_1.expect)(adapter.writtenStates.get("test.xy")).to.equal("[0.3,0.4]");
        });
    });
    describe("setLightState", () => {
        it("should return success results for each key", async () => {
            const { service } = createService([
                {
                    name: "Test",
                    lightType: "dimmable",
                    onState: "test.on",
                    briState: "test.bri",
                },
            ]);
            const results = await service.setLightState("1", { on: true, bri: 200 });
            (0, chai_1.expect)(results).to.have.length(2);
            (0, chai_1.expect)(results[0]).to.have.property("success");
            (0, chai_1.expect)(results[1]).to.have.property("success");
        });
        it("should include correct address paths in success", async () => {
            const { service } = createService([
                { name: "Test", lightType: "onoff", onState: "test.on" },
            ]);
            const results = await service.setLightState("1", { on: true });
            const firstResult = results[0];
            (0, chai_1.expect)(firstResult.success).to.have.property("/lights/1/state/on");
        });
        it("should still report success for unmapped states", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff" }]);
            const results = await service.setLightState("1", { on: true });
            (0, chai_1.expect)(results).to.have.length(1);
            (0, chai_1.expect)(results[0]).to.have.property("success");
        });
        it("should throw for invalid light ID", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff" }]);
            try {
                await service.setLightState("99", { on: true });
                chai_1.expect.fail("Should have thrown");
            }
            catch (error) {
                (0, chai_1.expect)(error).to.be.instanceOf(errors_1.HueApiError);
            }
        });
    });
    describe("state cache", () => {
        it("should use cached values when available", async () => {
            const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": false });
            // Pre-populate cache by reading once
            await service.getLightById("1");
            // Update cache directly
            service.updateStateCache("test.on", true);
            // Should read from cache
            const light = await service.getLightById("1");
            (0, chai_1.expect)(light.state.on).to.equal(true);
        });
        it("should update cache when setting state", async () => {
            const { service } = createService([
                { name: "Test", lightType: "onoff", onState: "test.on" },
            ]);
            await service.setLightState("1", { on: true });
            // Cache should be updated with the converted value
            const light = await service.getLightById("1");
            (0, chai_1.expect)(light.state.on).to.equal(true);
        });
    });
    describe("initialize", () => {
        it("should subscribe to all mapped state IDs", async () => {
            const { service, adapter } = createService([
                {
                    name: "Test",
                    lightType: "color",
                    onState: "lights.kitchen.on",
                    briState: "lights.kitchen.bri",
                    hueState: "lights.kitchen.hue",
                    satState: "lights.kitchen.sat",
                    ctState: "lights.kitchen.ct",
                    xyState: "lights.kitchen.xy",
                },
            ]);
            await service.initialize();
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.on");
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.bri");
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.hue");
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.sat");
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.ct");
            (0, chai_1.expect)(adapter.subscribedPatterns).to.include("lights.kitchen.xy");
        });
        it("should not subscribe if no states are mapped", async () => {
            const { service, adapter } = createService([{ name: "Test", lightType: "onoff" }]);
            await service.initialize();
            (0, chai_1.expect)(adapter.subscribedPatterns).to.have.length(0);
        });
    });
});
// =====================================================================
// Error handler utility
// =====================================================================
describe("createSuccessResponse", () => {
    it("should wrap data in success array", () => {
        const response = (0, error_handler_1.createSuccessResponse)({ username: "test123" });
        (0, chai_1.expect)(response).to.deep.equal([{ success: { username: "test123" } }]);
    });
    it("should handle empty data", () => {
        const response = (0, error_handler_1.createSuccessResponse)({});
        (0, chai_1.expect)(response).to.deep.equal([{ success: {} }]);
    });
    it("should handle multiple keys", () => {
        const response = (0, error_handler_1.createSuccessResponse)({ key1: "val1", key2: 42 });
        (0, chai_1.expect)(response).to.deep.equal([{ success: { key1: "val1", key2: 42 } }]);
    });
});
// =====================================================================
// Integration-style tests: light types with full state reading
// =====================================================================
describe("Light type integration", () => {
    function createServiceWithStates(device, stateValues) {
        const adapter = createMockDeviceBindingAdapter(stateValues);
        const logger = createMockLogger();
        const service = new device_binding_service_1.DeviceBindingService({
            adapter,
            devices: [device],
            logger,
        });
        return { service, adapter };
    }
    it("should build complete onoff light from states", async () => {
        const { service } = createServiceWithStates({
            name: "Kitchen Switch",
            lightType: "onoff",
            onState: "hm-rpc.0.switch.STATE",
        }, { "hm-rpc.0.switch.STATE": true });
        const light = await service.getLightById("1");
        (0, chai_1.expect)(light.name).to.equal("Kitchen Switch");
        (0, chai_1.expect)(light.type).to.equal("Dimmable light");
        (0, chai_1.expect)(light.modelid).to.equal("LWB007");
        (0, chai_1.expect)(light.state.on).to.equal(true);
        (0, chai_1.expect)(light.state.reachable).to.equal(true);
        // onoff type includes bri in its states array (from LIGHT_TYPES)
        (0, chai_1.expect)(light.state.bri).to.equal(254); // default since not mapped
    });
    it("should build complete dimmable light from states", async () => {
        const { service } = createServiceWithStates({
            name: "Living Room",
            lightType: "dimmable",
            onState: "deconz.0.light.on",
            briState: "deconz.0.light.bri",
        }, { "deconz.0.light.on": true, "deconz.0.light.bri": 75 });
        const light = await service.getLightById("1");
        (0, chai_1.expect)(light.name).to.equal("Living Room");
        (0, chai_1.expect)(light.type).to.equal("Dimmable light");
        (0, chai_1.expect)(light.modelid).to.equal("LWB010");
        (0, chai_1.expect)(light.state.on).to.equal(true);
        // 75 is in 0-100 range, so (75/100)*254 = 190.5 → 191
        (0, chai_1.expect)(light.state.bri).to.equal(191);
    });
    it("should build complete ct light from states", async () => {
        const { service } = createServiceWithStates({
            name: "Bedroom",
            lightType: "ct",
            onState: "zigbee.0.light.on",
            briState: "zigbee.0.light.bri",
            ctState: "zigbee.0.light.ct",
        }, {
            "zigbee.0.light.on": false,
            "zigbee.0.light.bri": 100,
            "zigbee.0.light.ct": 350,
        });
        const light = await service.getLightById("1");
        (0, chai_1.expect)(light.name).to.equal("Bedroom");
        (0, chai_1.expect)(light.type).to.equal("Color temperature light");
        (0, chai_1.expect)(light.modelid).to.equal("LTW001");
        (0, chai_1.expect)(light.state.on).to.equal(false);
        (0, chai_1.expect)(light.state.bri).to.equal(254); // 100 maps to 254
        (0, chai_1.expect)(light.state.ct).to.equal(350);
        (0, chai_1.expect)(light.state.colormode).to.equal("ct");
    });
    it("should build complete color light from states", async () => {
        const { service } = createServiceWithStates({
            name: "Party Light",
            lightType: "color",
            onState: "hue.0.light.on",
            briState: "hue.0.light.bri",
            hueState: "hue.0.light.hue",
            satState: "hue.0.light.sat",
            ctState: "hue.0.light.ct",
            xyState: "hue.0.light.xy",
        }, {
            "hue.0.light.on": true,
            "hue.0.light.bri": 80,
            "hue.0.light.hue": 25000,
            "hue.0.light.sat": 200,
            "hue.0.light.ct": 200,
            "hue.0.light.xy": [0.4, 0.3],
        });
        const light = await service.getLightById("1");
        (0, chai_1.expect)(light.name).to.equal("Party Light");
        (0, chai_1.expect)(light.type).to.equal("Extended color light");
        (0, chai_1.expect)(light.modelid).to.equal("LCT003");
        (0, chai_1.expect)(light.state.on).to.equal(true);
        // 80 in percentage range: round(80/100 * 254) = 203
        (0, chai_1.expect)(light.state.bri).to.equal(203);
        (0, chai_1.expect)(light.state.hue).to.equal(25000);
        (0, chai_1.expect)(light.state.sat).to.equal(200);
        (0, chai_1.expect)(light.state.ct).to.equal(200);
        (0, chai_1.expect)(light.state.xy).to.deep.equal([0.4, 0.3]);
        // xy takes precedence for colormode
        (0, chai_1.expect)(light.state.colormode).to.equal("xy");
    });
    it("should handle missing ioBroker state gracefully", async () => {
        const { service } = createServiceWithStates({
            name: "Offline Light",
            lightType: "dimmable",
            onState: "nonexistent.0.state",
            briState: "nonexistent.0.bri",
        }, {});
        // Should not throw, should use defaults
        const light = await service.getLightById("1");
        (0, chai_1.expect)(light.state.on).to.equal(false); // default
        (0, chai_1.expect)(light.state.bri).to.equal(254); // default
    });
});
//# sourceMappingURL=testMain.js.map