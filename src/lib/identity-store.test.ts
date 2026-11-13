import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FAKE_CIPHER as cipher } from "../../test/test-helpers";
import { IDENTITY_FILE, KEY_FIELD, legacyKeyOf, readIdentity, resolveIdentity, writeIdentity } from "./identity-store";

// How native held a key v1.19.0 encrypted, for the take-over — readable here, unlike the file's cipher.
const encrypt = (v: string): string => `$/aes-192-cbc:ENC(${v})`;
const decrypt = (v: string): string => v.replace(/^\$\/aes-192-cbc:ENC\(([\s\S]*)\)$/, "$1");
const UDN = "12345678-1234-1234-1234-123456789abc";
/** A private key as node-forge writes one (made up). */
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";

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
    expect(readIdentity(dir, cipher)).toEqual({});
  });

  it("reads back what was written, creating the folder", () => {
    const folder = join(dir, "hueemu.0");
    writeIdentity(folder, { udn: UDN, tlsCert: "CERT", privateKey: PEM }, cipher);
    expect(readIdentity(folder, cipher)).toEqual({ identity: { udn: UDN, tlsCert: "CERT", privateKey: PEM } });
  });

  // S3/S7 (CLAUDE_PATTERNS.md, Geheimnisse, round 174): the fleet master stores the key encrypted, never in clear text.
  it("stores the private key encrypted by the fleet master, the rest as it is", () => {
    writeIdentity(dir, { udn: UDN, tlsCert: "CERT", privateKey: PEM }, cipher);
    expect(raw().includes("MIIEow")).toBe(false);
    expect(JSON.parse(raw())).toEqual({
      udn: UDN,
      tlsCert: "CERT",
      [KEY_FIELD]: { $encrypted: cipher.encrypt(JSON.stringify(PEM)) },
    });
  });

  it("keeps the file readable for the owner only — it holds the encrypted key", () => {
    writeIdentity(dir, { udn: UDN }, cipher);
    // Windows keeps no POSIX mode bits: node reports 0o666 for every writable file (the master's data-file.test.ts).
    expect(statSync(join(dir, IDENTITY_FILE)).mode & 0o777).toBe(process.platform === "win32" ? 0o666 : 0o600);
  });

  it("leaves no temporary file behind", () => {
    writeIdentity(dir, { udn: UDN }, cipher);
    writeIdentity(dir, { udn: UDN, tlsCert: "CERT", privateKey: PEM }, cipher);
    expect(() => statSync(join(dir, `${IDENTITY_FILE}.tmp`))).toThrow();
    expect(readIdentity(dir, cipher)).toEqual({ identity: { udn: UDN, tlsCert: "CERT", privateKey: PEM } });
  });

  it("reports a file that is no JSON", () => {
    writeFileSync(join(dir, IDENTITY_FILE), "{ broken");
    expect(readIdentity(dir, cipher).error).toMatch(/no JSON/);
  });

  it("reports a file without a UDN — also one whose UDN is not text", () => {
    writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify({ udn: 42 }));
    expect(readIdentity(dir, cipher)).toEqual({ error: "no UDN in it" });
    writeFileSync(join(dir, IDENTITY_FILE), "null");
    expect(readIdentity(dir, cipher)).toEqual({ error: "no UDN in it" });
  });

  // A key encrypted under another system secret is no key: the file is unusable, never read as one without a key.
  it("reports a file whose key cannot be decrypted", () => {
    writeFileSync(
      join(dir, IDENTITY_FILE),
      JSON.stringify({ udn: UDN, tlsCert: "CERT", [KEY_FIELD]: { $encrypted: "x" } }),
    );
    expect(readIdentity(dir, cipher)).toEqual({ error: "secret field privateKey cannot be decrypted" });
  });

  it("drops half a TLS pair — a certificate without its key is no material", () => {
    writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify({ udn: ` ${UDN} `, tlsCert: "CERT" }));
    expect(readIdentity(dir, cipher)).toEqual({ identity: { udn: UDN } });
  });
});

describe("legacyKeyOf", () => {
  it("decrypts only a value with js-controller's prefix", () => {
    const spy = vi.fn(decrypt);
    expect(legacyKeyOf("$/aes-192-cbc:ENC(PEM)", spy)).toBe("PEM");
    expect(legacyKeyOf("PEM", spy)).toBe("PEM");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives no key for a value that cannot be decrypted", () => {
    expect(
      legacyKeyOf("$/aes-192-cbc:broken", () => {
        throw new Error("bad decrypt");
      }),
    ).toBe("");
  });
});

describe("resolveIdentity", () => {
  const fresh = (): string => "fresh-udn";

  it("takes the stored identity as it is — nothing to store", () => {
    const stored = { udn: UDN };
    expect(resolveIdentity(stored, { udn: "other", tlsCert: "C", tlsKey: "K" }, fresh, decrypt)).toEqual({
      identity: stored,
      unsaved: false,
    });
  });

  // v1.19.0 left the key encrypted in native, earlier versions in clear text: the file's master gets it in clear text.
  it("takes over what native held, the key in clear text whichever form native held it in", () => {
    for (const tlsKey of ["K", encrypt("K")]) {
      expect(resolveIdentity(undefined, { udn: ` ${UDN} `, tlsCert: "C", tlsKey }, fresh, decrypt)).toEqual({
        identity: { udn: UDN, tlsCert: "C", privateKey: "K" },
        unsaved: true,
      });
    }
  });

  it("creates a UDN when native holds none or no text", () => {
    for (const udn of [undefined, "", "  ", 12345, null]) {
      expect(resolveIdentity(undefined, { udn, tlsCert: undefined, tlsKey: undefined }, fresh, decrypt)).toEqual({
        identity: { udn: "fresh-udn" },
        unsaved: true,
      });
    }
  });

  it("takes over no half TLS pair — also not one whose key cannot be decrypted", () => {
    expect(resolveIdentity(undefined, { udn: UDN, tlsCert: "C", tlsKey: "" }, fresh, decrypt).identity).toEqual({
      udn: UDN,
    });
    const broken = (): string => {
      throw new Error("bad decrypt");
    };
    expect(
      resolveIdentity(undefined, { udn: UDN, tlsCert: "C", tlsKey: encrypt("K") }, fresh, broken).identity,
    ).toEqual({ udn: UDN });
  });
});
