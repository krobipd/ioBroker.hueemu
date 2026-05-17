/**
 * Tests for the shared boundary coercion helpers.
 */

import { coerceFiniteNumber, parseLightIndex } from "./coerce";

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
