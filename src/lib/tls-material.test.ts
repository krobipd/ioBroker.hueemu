/**
 * Tests for the self-signed TLS material. Split out of `main.test.ts` in
 * v1.17.0, when certificate handling moved out of the adapter lifecycle it
 * never belonged to.
 *
 * Two files' worth of proof: the decision logic runs against a node-forge mock
 * (fast, deterministic dates), and ONE test generates a real certificate and
 * loads it the way Fastify will — the mock cannot prove that the PEM the
 * adapter writes is one OpenSSL accepts. v1.18.0: persisting moved to the
 * caller (`buildConfig`, one merge with the bridge identity); those tests live
 * in `main.test.ts` now.
 */

import type { Mock } from "vitest";
import type * as NodeForge from "node-forge";
import { createSecureContext } from "node:tls";
import { CERT_VALIDITY_YEARS, generateCertificate, getOrCreateTlsMaterial, tlsPairUsable } from "./tls-material";

const forgeControl = vi.hoisted(() => ({
  notAfter: new Date("2090-01-01T00:00:00Z"),
  parseThrows: false,
  mocked: true,
}));

vi.mock("node-forge", async importOriginal => {
  const actual = await importOriginal<typeof NodeForge>();
  const mocked = {
    pki: {
      rsa: { generateKeyPair: vi.fn(() => ({ publicKey: {}, privateKey: {} })) },
      createCertificate: vi.fn(() => ({
        publicKey: null,
        serialNumber: "",
        validity: { notBefore: new Date(), notAfter: new Date() },
        setSubject: vi.fn(),
        setIssuer: vi.fn(),
        sign: vi.fn(),
      })),
      certificateFromPem: vi.fn(() => {
        if (forgeControl.parseThrows) {
          throw new Error("malformed PEM");
        }
        return { validity: { notAfter: forgeControl.notAfter } };
      }),
      certificateToPem: vi.fn(() => "-----BEGIN CERTIFICATE-----\nGENERATED\n-----END CERTIFICATE-----"),
      privateKeyToPem: vi.fn(() => "-----BEGIN RSA PRIVATE KEY-----\nGENERATED\n-----END RSA PRIVATE KEY-----"),
    },
    md: { sha256: { create: vi.fn(() => ({})) } },
  };
  // The real library for the one test that needs it, the mock for the rest —
  // switched per call so the two never bleed into each other.
  return {
    pki: new Proxy(mocked.pki, {
      get: (target, prop: keyof typeof mocked.pki) => (forgeControl.mocked ? target[prop] : actual.pki[prop]),
    }),
    md: new Proxy(mocked.md, {
      get: (target, prop: keyof typeof mocked.md) => (forgeControl.mocked ? target[prop] : actual.md[prop]),
    }),
  };
});

const PERSISTED_CERT = "-----BEGIN CERTIFICATE-----\nPERSISTED\n-----END CERTIFICATE-----";
const PERSISTED_KEY = "-----BEGIN RSA PRIVATE KEY-----\nPERSISTED\n-----END RSA PRIVATE KEY-----";

/** A log that records what was said. */
function makeLog(): { debug: Mock; warn: Mock } {
  return { debug: vi.fn((_message: string) => {}), warn: vi.fn((_message: string) => {}) };
}

beforeEach(() => {
  forgeControl.notAfter = new Date("2090-01-01T00:00:00Z");
  forgeControl.parseThrows = false;
  forgeControl.mocked = true;
});

describe("getOrCreateTlsMaterial", () => {
  it("reuses a persisted, still-valid certificate without regenerating", () => {
    const log = makeLog();
    const material = getOrCreateTlsMaterial(PERSISTED_CERT, PERSISTED_KEY, log, () => true);
    expect(material).toEqual({ cert: PERSISTED_CERT, key: PERSISTED_KEY, generated: false });
    expect(log.warn).not.toHaveBeenCalled();
  });

  // v1.19.0 (audit 2026-09-25 Q4): a key from another pair or a truncated key used to
  // be reused, and the HTTPS listen took the whole bridge down with it.
  it("regenerates when the persisted key does not fit the certificate", () => {
    const log = makeLog();
    const material = getOrCreateTlsMaterial(PERSISTED_CERT, PERSISTED_KEY, log, () => false);
    expect(material.cert).toContain("GENERATED");
    expect(material.generated).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("does not fit"));
  });

  it("regenerates when the persisted certificate is expired", () => {
    forgeControl.notAfter = new Date("2020-01-01T00:00:00Z");
    const log = makeLog();
    const material = getOrCreateTlsMaterial(PERSISTED_CERT, PERSISTED_KEY, log);
    expect(material.cert).toContain("GENERATED");
    expect(material.generated).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("expired"));
  });

  it("regenerates when the persisted certificate fails to parse (corruption guard)", () => {
    forgeControl.parseThrows = true;
    const log = makeLog();
    const material = getOrCreateTlsMaterial(PERSISTED_CERT, PERSISTED_KEY, log);
    expect(material.cert).toContain("GENERATED");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
  });

  it("generates fresh material when nothing is persisted", () => {
    const material = getOrCreateTlsMaterial(undefined, undefined, makeLog());
    expect(material.cert).toContain("GENERATED");
    expect(material.generated).toBe(true);
  });

  it("ignores a half-persisted pair and a non-string value", () => {
    expect(getOrCreateTlsMaterial(PERSISTED_CERT, "", makeLog()).cert).toContain("GENERATED");
    expect(getOrCreateTlsMaterial(42, PERSISTED_KEY, makeLog()).cert).toContain("GENERATED");
  });
});

describe("generateCertificate (real node-forge)", () => {
  // The one thing the mock cannot tell: whether the PEM pair the adapter stores
  // and hands to Fastify is material OpenSSL loads. Real 2048-bit keygen, ~1 s.
  it("produces a self-signed pair that Node's TLS accepts, valid for the documented years", async () => {
    forgeControl.mocked = false;
    const forge = await vi.importActual<typeof NodeForge>("node-forge");
    const material = generateCertificate();

    expect(() => createSecureContext({ cert: material.cert, key: material.key })).not.toThrow();

    const cert = forge.pki.certificateFromPem(material.cert);
    expect(cert.subject.getField("CN").value).toBe("Philips Hue");
    expect(cert.issuer.getField("CN").value).toBe("Philips Hue");
    expect(cert.validity.notAfter.getFullYear() - cert.validity.notBefore.getFullYear()).toBe(CERT_VALIDITY_YEARS);
    // RFC 5280: a positive serial — the top bit is cleared before hex-encoding.
    expect(parseInt(cert.serialNumber.slice(0, 2), 16) & 0x80).toBe(0);
    // A parsed persisted pair is what the next start reuses.
    expect(getOrCreateTlsMaterial(material.cert, material.key, makeLog()).generated).toBe(false);
  });

  it("tells a fitting pair from a foreign or a truncated key", () => {
    forgeControl.mocked = false;
    const a = generateCertificate();
    const b = generateCertificate();
    expect(tlsPairUsable(a.cert, a.key)).toBe(true);
    expect(tlsPairUsable(a.cert, b.key)).toBe(false);
    expect(tlsPairUsable(a.cert, a.key.slice(0, 200))).toBe(false);
  });
});
