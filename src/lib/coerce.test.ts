/**
 * Tests for the shared boundary coercion helpers.
 */

import { expect } from "chai";
import { coerceFiniteNumber, parseLightIndex } from "./coerce";

describe("coerceFiniteNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(coerceFiniteNumber(0)).to.equal(0);
    expect(coerceFiniteNumber(42)).to.equal(42);
    expect(coerceFiniteNumber(-3.5)).to.equal(-3.5);
  });

  it("returns null for non-finite numbers", () => {
    expect(coerceFiniteNumber(Number.NaN)).to.be.null;
    expect(coerceFiniteNumber(Number.POSITIVE_INFINITY)).to.be.null;
    expect(coerceFiniteNumber(Number.NEGATIVE_INFINITY)).to.be.null;
  });

  it("parses numeric strings", () => {
    expect(coerceFiniteNumber("42")).to.equal(42);
    expect(coerceFiniteNumber("0.5")).to.equal(0.5);
    expect(coerceFiniteNumber("-3")).to.equal(-3);
  });

  it("returns null for non-numeric strings and other types", () => {
    expect(coerceFiniteNumber("")).to.be.null;
    expect(coerceFiniteNumber("abc")).to.be.null;
    expect(coerceFiniteNumber(null)).to.be.null;
    expect(coerceFiniteNumber(undefined)).to.be.null;
    expect(coerceFiniteNumber({})).to.be.null;
    expect(coerceFiniteNumber([])).to.be.null;
    expect(coerceFiniteNumber(true)).to.be.null;
  });
});

describe("parseLightIndex (E1 v1.4.3)", () => {
  it("returns 0-based index for valid 1-based id", () => {
    expect(parseLightIndex("1", 5)).to.equal(0);
    expect(parseLightIndex("3", 5)).to.equal(2);
    expect(parseLightIndex("5", 5)).to.equal(4);
  });

  it("returns null for ids out of range", () => {
    expect(parseLightIndex("0", 5)).to.be.null;
    expect(parseLightIndex("6", 5)).to.be.null;
    expect(parseLightIndex("100", 5)).to.be.null;
  });

  it("returns null for non-integer strings (NaN-trap fix)", () => {
    expect(parseLightIndex("abc", 5)).to.be.null;
    expect(parseLightIndex("1.5", 5)).to.be.null;
    expect(parseLightIndex("-1", 5)).to.be.null;
    expect(parseLightIndex(" 1", 5)).to.be.null;
    expect(parseLightIndex("1 ", 5)).to.be.null;
    expect(parseLightIndex("1e2", 5)).to.be.null;
  });

  it("returns null for non-string inputs", () => {
    expect(parseLightIndex(1, 5)).to.be.null;
    expect(parseLightIndex(null, 5)).to.be.null;
    expect(parseLightIndex(undefined, 5)).to.be.null;
    expect(parseLightIndex({}, 5)).to.be.null;
  });

  it("returns null when the collection is empty", () => {
    expect(parseLightIndex("1", 0)).to.be.null;
  });
});
