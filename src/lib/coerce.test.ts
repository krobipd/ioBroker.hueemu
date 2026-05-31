/**
 * Tests for the shared boundary coercion helpers.
 */

import { coerceBool, coerceFiniteNumber, parseLightIndex, parsePort } from "./coerce";

describe("coerceFiniteNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(coerceFiniteNumber(0)).toBe(0);
    expect(coerceFiniteNumber(42)).toBe(42);
    expect(coerceFiniteNumber(-3.5)).toBe(-3.5);
  });

  it("returns null for non-finite numbers", () => {
    expect(coerceFiniteNumber(Number.NaN)).toBeNull();
    expect(coerceFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(coerceFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("parses numeric strings", () => {
    expect(coerceFiniteNumber("42")).toBe(42);
    expect(coerceFiniteNumber("0.5")).toBe(0.5);
    expect(coerceFiniteNumber("-3")).toBe(-3);
  });

  it("returns null for non-numeric strings and other types", () => {
    expect(coerceFiniteNumber("")).toBeNull();
    expect(coerceFiniteNumber("abc")).toBeNull();
    expect(coerceFiniteNumber(null)).toBeNull();
    expect(coerceFiniteNumber(undefined)).toBeNull();
    expect(coerceFiniteNumber({})).toBeNull();
    expect(coerceFiniteNumber([])).toBeNull();
    expect(coerceFiniteNumber(true)).toBeNull();
  });
});

describe("parseLightIndex (E1 v1.4.3)", () => {
  it("returns 0-based index for valid 1-based id", () => {
    expect(parseLightIndex("1", 5)).toBe(0);
    expect(parseLightIndex("3", 5)).toBe(2);
    expect(parseLightIndex("5", 5)).toBe(4);
  });

  it("returns null for ids out of range", () => {
    expect(parseLightIndex("0", 5)).toBeNull();
    expect(parseLightIndex("6", 5)).toBeNull();
    expect(parseLightIndex("100", 5)).toBeNull();
  });

  it("returns null for non-integer strings (NaN-trap fix)", () => {
    expect(parseLightIndex("abc", 5)).toBeNull();
    expect(parseLightIndex("1.5", 5)).toBeNull();
    expect(parseLightIndex("-1", 5)).toBeNull();
    expect(parseLightIndex(" 1", 5)).toBeNull();
    expect(parseLightIndex("1 ", 5)).toBeNull();
    expect(parseLightIndex("1e2", 5)).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(parseLightIndex(1, 5)).toBeNull();
    expect(parseLightIndex(null, 5)).toBeNull();
    expect(parseLightIndex(undefined, 5)).toBeNull();
    expect(parseLightIndex({}, 5)).toBeNull();
  });

  it("returns null when the collection is empty", () => {
    expect(parseLightIndex("1", 0)).toBeNull();
  });
});

describe("coerceBool", () => {
  it("returns real booleans unchanged", () => {
    expect(coerceBool(true)).toBe(true);
    expect(coerceBool(false)).toBe(false);
  });

  it("treats non-zero numbers as true, 0 as false", () => {
    expect(coerceBool(1)).toBe(true);
    expect(coerceBool(-1)).toBe(true);
    expect(coerceBool(0)).toBe(false);
  });

  it("accepts true-ish strings (case-insensitive, trimmed)", () => {
    expect(coerceBool("true")).toBe(true);
    expect(coerceBool("TRUE")).toBe(true);
    expect(coerceBool(" yes ")).toBe(true);
    expect(coerceBool("1")).toBe(true);
    expect(coerceBool("on")).toBe(true);
  });

  it("treats false/0/empty/other strings as false (disableAuth must not flip on a stored string)", () => {
    expect(coerceBool("false")).toBe(false);
    expect(coerceBool("0")).toBe(false);
    expect(coerceBool("")).toBe(false);
    expect(coerceBool("nope")).toBe(false);
  });

  it("returns false for null/undefined/object", () => {
    expect(coerceBool(null)).toBe(false);
    expect(coerceBool(undefined)).toBe(false);
    expect(coerceBool({})).toBe(false);
    expect(coerceBool([])).toBe(false);
  });
});

describe("parsePort", () => {
  it("returns finite numbers as-is", () => {
    expect(parsePort(8080)).toBe(8080);
    expect(parsePort(80)).toBe(80);
  });

  it("parses numeric strings (trimmed)", () => {
    expect(parsePort("8080")).toBe(8080);
    expect(parsePort(" 443 ")).toBe(443);
  });

  it("returns undefined for missing / empty / non-numeric input", () => {
    expect(parsePort(undefined)).toBeUndefined();
    expect(parsePort(null)).toBeUndefined();
    expect(parsePort("")).toBeUndefined();
    expect(parsePort("   ")).toBeUndefined();
    expect(parsePort("abc")).toBeUndefined();
    expect(parsePort({})).toBeUndefined();
  });

  it("returns undefined for non-finite numbers", () => {
    expect(parsePort(Number.NaN)).toBeUndefined();
    expect(parsePort(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
