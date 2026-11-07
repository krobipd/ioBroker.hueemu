/**
 * Tests for shared utility functions
 */

import { oneLine, sanitizeId } from "./utils";

describe("sanitizeId", () => {
  it("should pass through alphanumeric strings unchanged", () => {
    expect(sanitizeId("abc123")).toBe("abc123");
  });

  it("should pass through hyphens and underscores", () => {
    expect(sanitizeId("my-device_01")).toBe("my-device_01");
  });

  it("should replace dots with underscore", () => {
    expect(sanitizeId("alexa.device.1")).toBe("alexa_device_1");
  });

  it("should replace spaces with underscore", () => {
    expect(sanitizeId("my device")).toBe("my_device");
  });

  it("should replace special characters with underscore", () => {
    expect(sanitizeId("user@host:1234")).toBe("user_host_1234");
  });

  it("should handle Alexa-style UUIDs", () => {
    expect(sanitizeId("2WLEDHardworworworworworwo#Srehto")).toBe("2WLEDHardworworworworworwo_Srehto");
  });

  it("should handle empty string", () => {
    expect(sanitizeId("")).toBe("");
  });

  it("should replace multiple consecutive special chars", () => {
    expect(sanitizeId("a..b//c")).toBe("a__b__c");
  });

  it("should handle Harmony Hub style identifiers", () => {
    expect(sanitizeId("harmony-hub-192.168.1.50")).toBe("harmony-hub-192_168_1_50");
  });

  it("should preserve uppercase and lowercase", () => {
    expect(sanitizeId("MyDevice")).toBe("MyDevice");
  });
});

describe("oneLine", () => {
  it("neutralises the rest of the C0 range and DEL too (terminal escapes, NUL)", () => {
    expect(oneLine("a\u001b[31mred\u0000\u007fb")).toBe("a [31mred  b");
  });

  it("leaves non-ASCII text alone", () => {
    expect(oneLine("Küche — Lämpchen ✓")).toBe("Küche — Lämpchen ✓");
  });

  it("replaces CR, LF and tab with spaces", () => {
    expect(oneLine("a\r\nb\tc")).toBe("a  b c");
  });

  it("passes through a normal string unchanged", () => {
    expect(oneLine("Amazon Echo Dot")).toBe("Amazon Echo Dot");
  });

  it("neutralises a forged log line in an untrusted value", () => {
    expect(oneLine("hub\n2026-01-01 info: forged admin line")).toBe("hub 2026-01-01 info: forged admin line");
  });

  it("handles empty string", () => {
    expect(oneLine("")).toBe("");
  });
});
