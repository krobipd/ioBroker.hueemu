/**
 * Tests for shared utility functions
 */

import { expect } from "chai";
import { sanitizeId } from "./utils";

describe("sanitizeId", () => {
  it("should pass through alphanumeric strings unchanged", () => {
    expect(sanitizeId("abc123")).to.equal("abc123");
  });

  it("should pass through hyphens and underscores", () => {
    expect(sanitizeId("my-device_01")).to.equal("my-device_01");
  });

  it("should replace dots with underscore", () => {
    expect(sanitizeId("alexa.device.1")).to.equal("alexa_device_1");
  });

  it("should replace spaces with underscore", () => {
    expect(sanitizeId("my device")).to.equal("my_device");
  });

  it("should replace special characters with underscore", () => {
    expect(sanitizeId("user@host:1234")).to.equal("user_host_1234");
  });

  it("should handle Alexa-style UUIDs", () => {
    // Alexa sends usernames like "2WLEDHardworworworworworwo#Srehto"
    expect(sanitizeId("2WLEDHardworworworworworwo#Srehto")).to.equal(
      "2WLEDHardworworworworworwo_Srehto",
    );
  });

  it("should handle empty string", () => {
    expect(sanitizeId("")).to.equal("");
  });

  it("should replace multiple consecutive special chars", () => {
    expect(sanitizeId("a..b//c")).to.equal("a__b__c");
  });

  it("should handle Harmony Hub style identifiers", () => {
    expect(sanitizeId("harmony-hub-192.168.1.50")).to.equal(
      "harmony-hub-192_168_1_50",
    );
  });

  it("should preserve uppercase and lowercase", () => {
    expect(sanitizeId("MyDevice")).to.equal("MyDevice");
  });
});
