/**
 * Tests for UPnP description XML generation
 */

import {
  generateDescriptionXml,
  getDescriptionUrl,
} from "./description-xml";
import { createTestIdentity } from "../../test/test-helpers";

describe("Description XML", () => {
  const identity = createTestIdentity();

  describe("generateDescriptionXml", () => {
    it("should generate valid XML with correct structure", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8" ?>');
      expect(xml).toContain("urn:schemas-upnp-org:device-1-0");
      expect(xml).toContain("urn:schemas-upnp-org:device:Basic:1");
    });

    it("should include host in friendlyName", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain("Philips hue (192.168.1.100)");
    });

    it("should include correct URLBase", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain("<URLBase>http://192.168.1.100:8080/</URLBase>");
    });

    it("should use custom urlBase when provided", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
        urlBase: "https://custom.host:9999/",
      });

      expect(xml).toContain("<URLBase>https://custom.host:9999/</URLBase>");
    });

    it("should include serial number from identity", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain(
        `<serialNumber>${identity.serialNumber}</serialNumber>`,
      );
    });

    it("should include UDN from identity", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain(`<UDN>uuid:${identity.udn}</UDN>`);
    });

    it("should include Philips hue bridge 2015 model", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain("<modelName>Philips hue bridge 2015</modelName>");
      expect(xml).toContain("<modelNumber>BSB002</modelNumber>");
    });

    it("should include Signify as manufacturer", () => {
      const xml = generateDescriptionXml({
        identity,
        host: "192.168.1.100",
        port: 8080,
      });

      expect(xml).toContain("<manufacturer>Signify</manufacturer>");
    });
  });

  describe("getDescriptionUrl", () => {
    it("should build correct description URL", () => {
      const url = getDescriptionUrl("192.168.1.100", 8080);
      expect(url).toBe("http://192.168.1.100:8080/description.xml");
    });

    it("should work with different ports", () => {
      const url = getDescriptionUrl("10.0.0.1", 80);
      expect(url).toBe("http://10.0.0.1:80/description.xml");
    });
  });
});
