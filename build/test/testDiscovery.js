"use strict";
/**
 * Tests for UPnP description XML generation
 */
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const description_xml_1 = require("../src/discovery/description-xml");
const testHelpers_1 = require("./testHelpers");
describe("Description XML", () => {
    const identity = (0, testHelpers_1.createTestIdentity)();
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
//# sourceMappingURL=testDiscovery.js.map