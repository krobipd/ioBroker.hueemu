import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IDENTITY_FILE, plainKeyOf, readIdentity, resolveIdentity, storedKeyOf, writeIdentity } from "./identity-store";

const encrypt = (v: string): string => `$/aes-192-cbc:ENC(${v})`;
const decrypt = (v: string): string => v.replace(/^\$\/aes-192-cbc:ENC\(([\s\S]*)\)$/, "$1");
const UDN = "12345678-1234-1234-1234-123456789abc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hueemu-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readIdentity / writeIdentity", () => {
  it("reads nothing and reports nothing before the first write", () => {
    expect(readIdentity(dir)).toEqual({});
  });

  it("reads back what was written, creating the folder", () => {
    const folder = join(dir, "hueemu.0");
    writeIdentity(folder, { udn: UDN, tlsCert: "CERT", tlsKey: "$/aes-192-cbc:KEY" });
    expect(readIdentity(folder)).toEqual({ identity: { udn: UDN, tlsCert: "CERT", tlsKey: "$/aes-192-cbc:KEY" } });
  });

  it("keeps the file readable for the owner only — it holds the encrypted key", () => {
    writeIdentity(dir, { udn: UDN });
    expect(statSync(join(dir, IDENTITY_FILE)).mode & 0o077).toBe(0);
  });

  it("leaves no temporary file behind", () => {
    writeIdentity(dir, { udn: UDN });
    writeIdentity(dir, { udn: UDN, tlsCert: "CERT", tlsKey: "KEY" });
    expect(() => statSync(join(dir, `${IDENTITY_FILE}.tmp`))).toThrow();
    expect(JSON.parse(readFileSync(join(dir, IDENTITY_FILE), "utf8"))).toEqual({
      udn: UDN,
      tlsCert: "CERT",
      tlsKey: "KEY",
    });
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

  it("drops half a TLS pair — a certificate without its key is no material", () => {
    writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify({ udn: ` ${UDN} `, tlsCert: "CERT" }));
    expect(readIdentity(dir)).toEqual({ identity: { udn: UDN } });
  });
});

describe("storedKeyOf / plainKeyOf", () => {
  it("stores a plain-text key encrypted and an encrypted one as it is", () => {
    expect(storedKeyOf("PEM", encrypt)).toBe("$/aes-192-cbc:ENC(PEM)");
    expect(storedKeyOf("$/aes-192-cbc:ENC(PEM)", encrypt)).toBe("$/aes-192-cbc:ENC(PEM)");
  });

  it("decrypts only a value with js-controller's prefix", () => {
    const spy = vi.fn(decrypt);
    expect(plainKeyOf("$/aes-192-cbc:ENC(PEM)", spy)).toBe("PEM");
    expect(plainKeyOf("PEM", spy)).toBe("PEM");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives no key for nothing and for a value that cannot be decrypted", () => {
    expect(plainKeyOf(undefined, decrypt)).toBe("");
    expect(
      plainKeyOf("$/aes-192-cbc:broken", () => {
        throw new Error("bad decrypt");
      }),
    ).toBe("");
  });
});

describe("resolveIdentity", () => {
  const fresh = (): string => "fresh-udn";

  it("takes the stored identity as it is — nothing to store", () => {
    const stored = { udn: UDN };
    expect(resolveIdentity(stored, { udn: "other", tlsCert: "C", tlsKey: "K" }, fresh, encrypt)).toEqual({
      identity: stored,
      unsaved: false,
    });
  });

  it("takes over what native held, the key encrypted", () => {
    expect(resolveIdentity(undefined, { udn: ` ${UDN} `, tlsCert: "C", tlsKey: "K" }, fresh, encrypt)).toEqual({
      identity: { udn: UDN, tlsCert: "C", tlsKey: "$/aes-192-cbc:ENC(K)" },
      unsaved: true,
    });
  });

  it("creates a UDN when native holds none or no text", () => {
    for (const udn of [undefined, "", "  ", 12345, null]) {
      expect(resolveIdentity(undefined, { udn, tlsCert: undefined, tlsKey: undefined }, fresh, encrypt)).toEqual({
        identity: { udn: "fresh-udn" },
        unsaved: true,
      });
    }
  });

  it("takes over no half TLS pair", () => {
    expect(resolveIdentity(undefined, { udn: UDN, tlsCert: "C", tlsKey: "" }, fresh, encrypt).identity).toEqual({
      udn: UDN,
    });
  });
});
