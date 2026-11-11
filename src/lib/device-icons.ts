/**
 * The pictogram of a light's device object in the object tree (`common.icon`), the fleet pattern of
 * CLAUDE_PATTERNS.md § "Geräte-Piktogramme im Objektbaum": the file itself as an inline
 * `data:image/svg+xml;base64,` URI, drawn in `currentColor` with `path` only — the admin puts that markup into
 * the DOM, so the pictogram takes the text colour of every theme; a path or a fixed colour would vanish in one
 * theme family.
 *
 * One pictogram for every light type: the tree shows that a device is a lamp, the light type stays a field of
 * the light. The file is read once per start — the light store takes the pictogram in its constructor, so the fleet
 * pattern's cache has nothing to save here; line endings are normalised first, so a Windows checkout (CRLF) embeds the
 * same bytes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The prefix of the inline form the admin renders into the DOM. */
export const ICON_URI_PREFIX = "data:image/svg+xml;base64,";

/** build/lib AND src/lib both sit two levels below the adapter root. */
const ICON_FILE = join(__dirname, "..", "..", "admin", "icons", "light.svg");

/**
 * The file's text with LF line endings.
 *
 * @param svg the file as read
 */
export function normaliseLineEndings(svg: string): string {
  return svg.replace(/\r\n/g, "\n");
}

/**
 * The inline URI of the light pictogram, undefined when the file cannot be read — then the field stays as it
 * is, it is never emptied.
 *
 * @returns the data URI
 */
export function lightIcon(): string | undefined {
  try {
    const svg = readFileSync(ICON_FILE, "utf8");
    return `${ICON_URI_PREFIX}${Buffer.from(normaliseLineEndings(svg)).toString("base64")}`;
  } catch {
    return undefined;
  }
}
