/**
 * Tests for shared utility functions
 */

import { oneLine } from "./utils";

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
