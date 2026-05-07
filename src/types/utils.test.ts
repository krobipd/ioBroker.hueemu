/**
 * Tests for shared utility functions
 */

import { expect } from "chai";
import { errText, sanitizeId } from "./utils";

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

describe("errText", () => {
  it("returns the message of an Error instance", () => {
    expect(errText(new Error("boom"))).to.equal("boom");
  });

  it("returns the message of an Error subclass", () => {
    class MyErr extends Error {
      constructor() {
        super("typed");
      }
    }
    expect(errText(new MyErr())).to.equal("typed");
  });

  it("returns 'null' for null", () => {
    expect(errText(null)).to.equal("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(errText(undefined)).to.equal("undefined");
  });

  it("returns string values as-is", () => {
    expect(errText("plain")).to.equal("plain");
  });

  it("stringifies number/boolean/bigint", () => {
    expect(errText(42)).to.equal("42");
    expect(errText(true)).to.equal("true");
    expect(errText(BigInt(99))).to.equal("99");
  });

  it("JSON.stringifies plain objects", () => {
    expect(errText({ code: 500, msg: "nope" })).to.equal('{"code":500,"msg":"nope"}');
  });

  it("falls back to Object.prototype.toString for circular objects", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(errText(a)).to.equal("[object Object]");
  });
});
