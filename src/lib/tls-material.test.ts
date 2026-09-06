/**
 * Tests for the self-signed TLS material. Split out of `main.test.ts` in
 * v1.17.0, when certificate handling moved out of the adapter lifecycle it
 * never belonged to — the same node-forge mock, now without standing up the
 * adapter around it.
 */

import type { Mock } from "vitest";
import { getOrCreateTlsMaterial, type TlsMaterialAdapter } from "./tls-material";

const forgeControl = vi.hoisted(() => ({
  notAfter: new Date("2090-01-01T00:00:00Z"),
  parseThrows: false,
}));

vi.mock("node-forge", () => ({
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
}));

const PERSISTED_CERT = "-----BEGIN CERTIFICATE-----\nPERSISTED\n-----END CERTIFICATE-----";
const PERSISTED_KEY = "-----BEGIN RSA PRIVATE KEY-----\nPERSISTED\n-----END RSA PRIVATE KEY-----";

/** A fake adapter surface that records what was persisted and logged. */
function makeAdapter(): {
  namespace: string;
  extendForeignObjectAsync: Mock;
  log: { debug: Mock; info: Mock; warn: Mock };
} & TlsMaterialAdapter {
  return {
    namespace: "hueemu.0",
    extendForeignObjectAsync: vi.fn((): Promise<unknown> => Promise.resolve()),
    log: {
      debug: vi.fn((_message: string) => {}),
      info: vi.fn((_message: string) => {}),
      warn: vi.fn((_message: string) => {}),
    },
  };
}

beforeEach(() => {
  forgeControl.notAfter = new Date("2090-01-01T00:00:00Z");
  forgeControl.parseThrows = false;
});

describe("getOrCreateTlsMaterial", () => {
  it("reuses a persisted, still-valid certificate without regenerating", async () => {
    const adapter = makeAdapter();
    const material = await getOrCreateTlsMaterial(adapter, PERSISTED_CERT, PERSISTED_KEY);
    expect(material).toEqual({ cert: PERSISTED_CERT, key: PERSISTED_KEY, persisted: false });
    expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("regenerates and persists when the persisted certificate is expired", async () => {
    forgeControl.notAfter = new Date("2020-01-01T00:00:00Z");
    const adapter = makeAdapter();
    const material = await getOrCreateTlsMaterial(adapter, PERSISTED_CERT, PERSISTED_KEY);
    expect(material.cert).toContain("GENERATED");
    expect(material.persisted).toBe(true);
    expect(adapter.log.warn).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(adapter.extendForeignObjectAsync).toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({ native: expect.objectContaining({ tlsCert: expect.stringContaining("GENERATED") }) }),
    );
  });

  it("regenerates when the persisted certificate fails to parse (corruption guard)", async () => {
    forgeControl.parseThrows = true;
    const adapter = makeAdapter();
    const material = await getOrCreateTlsMaterial(adapter, PERSISTED_CERT, PERSISTED_KEY);
    expect(material.cert).toContain("GENERATED");
    expect(adapter.log.warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
  });

  it("generates fresh material when nothing is persisted", async () => {
    const adapter = makeAdapter();
    const material = await getOrCreateTlsMaterial(adapter, undefined, undefined);
    expect(material.cert).toContain("GENERATED");
    expect(material.persisted).toBe(true);
    expect(adapter.log.info).toHaveBeenCalledWith(expect.stringContaining("persisted self-signed TLS certificate"));
  });

  it("ignores a half-persisted pair and a non-string value", async () => {
    const adapter = makeAdapter();
    expect((await getOrCreateTlsMaterial(adapter, PERSISTED_CERT, "")).cert).toContain("GENERATED");
    expect((await getOrCreateTlsMaterial(adapter, 42, PERSISTED_KEY)).cert).toContain("GENERATED");
  });

  it("still returns the generated material when persisting fails (warn, retry next restart)", async () => {
    const adapter = makeAdapter();
    adapter.extendForeignObjectAsync.mockRejectedValueOnce(new Error("db readonly"));
    const material = await getOrCreateTlsMaterial(adapter, undefined, undefined);
    expect(material.cert).toContain("GENERATED");
    expect(material.persisted).toBe(false);
    expect(adapter.log.warn).toHaveBeenCalledWith(expect.stringContaining("failed to persist"));
  });
});
