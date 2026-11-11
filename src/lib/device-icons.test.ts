import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ICON_URI_PREFIX, lightIcon, normaliseLineEndings } from "./device-icons";

const ICON_FILE = join(__dirname, "..", "..", "admin", "icons", "light.svg");
const svg = readFileSync(ICON_FILE, "utf8");

/**
 * The markup a data URI carries.
 *
 * @param uri the URI
 */
const decoded = (uri: string): string => Buffer.from(uri.slice(ICON_URI_PREFIX.length), "base64").toString("utf8");

describe("lightIcon", () => {
  it("is the file itself as an inline URI, never a path", () => {
    const uri = lightIcon();
    expect(uri?.startsWith(ICON_URI_PREFIX)).toBe(true);
    expect(decoded(uri ?? "")).toBe(normaliseLineEndings(svg));
  });
});

describe("normaliseLineEndings", () => {
  // The Windows runner checks out with CRLF — the same file must give the same URI there.
  it("turns a CRLF checkout into the bytes of the LF file", () => {
    expect(normaliseLineEndings(svg.replace(/\n/g, "\r\n"))).toBe(svg.replace(/\r\n/g, "\n"));
  });
});

// CLAUDE_PATTERNS.md § Geräte-Piktogramme im Objektbaum: the admin inlines the markup, so it takes the row's text
// colour only when drawn in currentColor, and the ID cell's CSS gives every element below the root a width.
describe("light.svg", () => {
  it("draws in currentColor only", () => {
    const colours = [...svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map(m => m[1]);
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.filter(c => c !== "currentColor" && c !== "none")).toEqual([]);
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|\b(?:black|white)\b/i);
  });

  it("draws with path and circle only, grouped by g at most", () => {
    const below = [...svg.matchAll(/<([a-zA-Z]+)/g)].map(m => m[1]).slice(1);
    expect(below.length).toBeGreaterThan(0);
    expect(below.filter(tag => !["path", "circle", "g"].includes(tag))).toEqual([]);
  });
});
