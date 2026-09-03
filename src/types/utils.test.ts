/**
 * Tests for shared utility functions
 */

import { errText, oneLine, sanitizeId } from "./utils";

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

describe("errText", () => {
  it("returns the message of an Error instance", () => {
    expect(errText(new Error("boom"))).toBe("boom");
  });

  it("returns the message of an Error subclass", () => {
    class MyErr extends Error {
      constructor() {
        super("typed");
      }
    }
    expect(errText(new MyErr())).toBe("typed");
  });

  it("returns 'null' for null", () => {
    expect(errText(null)).toBe("null");
  });

  it("returns 'undefined' for undefined", () => {
    expect(errText(undefined)).toBe("undefined");
  });

  it("returns string values as-is", () => {
    expect(errText("plain")).toBe("plain");
  });

  it("stringifies number/boolean/bigint", () => {
    expect(errText(42)).toBe("42");
    expect(errText(true)).toBe("true");
    expect(errText(BigInt(99))).toBe("99");
  });

  // v1.15.0 (fleet defect, first seen in parcelapp 2026-08-22): JSON.stringify
  // RETURNS `undefined` for these — it does not throw — so the try/catch never
  // fired and the log line read "… : undefined", losing the whole diagnosis.
  it("describes a symbol instead of returning undefined", () => {
    const text = errText(Symbol("nope"));
    expect(text).toContain("nope");
    expect(text).not.toBe("undefined");
  });

  it("describes a function instead of returning undefined", () => {
    expect(errText(() => "x")).toBe("[object Function]");
  });

  it("describes an object whose toJSON yields undefined", () => {
    expect(errText({ toJSON: () => undefined })).toBe("[object Object]");
  });

  it("JSON.stringifies plain objects", () => {
    expect(errText({ code: 500, msg: "nope" })).toBe('{"code":500,"msg":"nope"}');
  });

  it("falls back to Object.prototype.toString for circular objects", () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(errText(a)).toBe("[object Object]");
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
