import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IDENTITY_FILE, readIdentity, resolveIdentity, writeIdentity } from "./identity-store";

const UDN = "12345678-1234-1234-1234-123456789abc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hueemu-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** What the file holds, as it lies on the disk. */
const raw = (): string => readFileSync(join(dir, IDENTITY_FILE), "utf8");

describe("readIdentity / writeIdentity", () => {
  it("reads nothing and reports nothing before the first write", () => {
    expect(readIdentity(dir)).toEqual({});
  });

  it("reads back what was written, creating the folder", () => {
    const folder = join(dir, "hueemu.0");
    writeIdentity(folder, { udn: UDN });
    expect(readIdentity(folder)).toEqual({ identity: { udn: UDN } });
  });

  // The own certificate is gone with the fleet's HTTPS option (krobi 2026-11-14 19:15): the file holds the UDN alone.
  it("stores the UDN and nothing else", () => {
    writeIdentity(dir, { udn: UDN });
    expect(JSON.parse(raw())).toEqual({ udn: UDN });
  });

  it("keeps the file readable for the owner only", () => {
    writeIdentity(dir, { udn: UDN });
    // Windows keeps no POSIX mode bits: node reports 0o666 for every writable file (the master's data-file.test.ts).
    expect(statSync(join(dir, IDENTITY_FILE)).mode & 0o777).toBe(process.platform === "win32" ? 0o666 : 0o600);
  });

  it("leaves no temporary file behind", () => {
    writeIdentity(dir, { udn: "first" });
    writeIdentity(dir, { udn: UDN });
    expect(() => statSync(join(dir, `${IDENTITY_FILE}.tmp`))).toThrow();
    expect(readIdentity(dir)).toEqual({ identity: { udn: UDN } });
  });

  it("reports a file that is no JSON", () => {
    writeFileSync(join(dir, IDENTITY_FILE), "{ broken");
    expect(readIdentity(dir).error).toMatch(/no JSON/);
  });

  it("reports a file without a UDN — also one whose UDN is not text", () => {
    writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify({ udn: 42 }));
    expect(readIdentity(dir)).toEqual({ error: "no UDN in it" });
    writeFileSync(join(dir, IDENTITY_FILE), "null");
    expect(readIdentity(dir)).toEqual({ error: "no UDN in it" });
  });

  it("reads the UDN trimmed and nothing else of the file", () => {
    writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify({ udn: ` ${UDN} `, tlsCert: "CERT" }));
    expect(readIdentity(dir)).toEqual({ identity: { udn: UDN } });
  });
});

describe("resolveIdentity", () => {
  const fresh = (): string => "fresh-udn";

  it("takes the stored identity as it is — nothing to store", () => {
    const stored = { udn: UDN };
    expect(resolveIdentity(stored, { udn: "other" }, fresh)).toEqual({ identity: stored, unsaved: false });
  });

  it("takes over the UDN native held", () => {
    expect(resolveIdentity(undefined, { udn: ` ${UDN} ` }, fresh)).toEqual({ identity: { udn: UDN }, unsaved: true });
  });

  it("creates a UDN when native holds none or no text", () => {
    for (const udn of [undefined, "", "  ", 12345, null]) {
      expect(resolveIdentity(undefined, { udn }, fresh)).toEqual({ identity: { udn: "fresh-udn" }, unsaved: true });
    }
  });
});
