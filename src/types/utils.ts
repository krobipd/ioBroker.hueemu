/**
 * Shared utility functions
 */

/**
 * Collapse control characters in an untrusted string to single spaces so
 * client-supplied values (usernames, devicetypes) cannot forge extra lines or
 * smuggle terminal escapes when interpolated into a log message. Covers the
 * whole C0 range (CR/LF/tab, ESC, …) plus DEL — not just the line breaks.
 *
 * @param s - Raw, potentially attacker-controlled string to make log-safe
 */
export function oneLine(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out;
}
