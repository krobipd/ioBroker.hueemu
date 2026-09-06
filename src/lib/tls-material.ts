/**
 * Self-signed TLS material for the optional HTTPS listener.
 *
 * Extracted from `main.ts` in v1.17.0, in the same shape `lib/migrations.ts`
 * already uses: a pure helper plus a typed dependency interface, so the crypto
 * can be tested without standing up the adapter lifecycle. Certificate handling
 * has nothing to do with the adapter's lifecycle — it only happened to live
 * next to it.
 */

import * as forge from "node-forge";
import { randomBytes } from "node:crypto";
import { errText } from "../types/utils";

/** A PEM certificate/key pair. */
export interface TlsMaterial {
  /** PEM-encoded certificate. */
  cert: string;
  /** PEM-encoded private key. */
  key: string;
}

/** The result of resolving the material, plus whether it had to be persisted. */
export interface TlsMaterialResult extends TlsMaterial {
  /**
   * True when new material was written into `native` — that write restarts the
   * instance, so the caller must not bind servers afterwards.
   */
  persisted: boolean;
}

/** Adapter surface required by {@link getOrCreateTlsMaterial}. */
export interface TlsMaterialAdapter {
  /** Adapter namespace (e.g. hueemu.0) */
  namespace: string;
  /** Persist generated material into the instance's native config */
  extendForeignObjectAsync(id: string, obj: { native: { tlsCert: string; tlsKey: string } }): Promise<unknown>;
  /** Logger */
  log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
}

/** How long a freshly generated certificate stays valid. */
const CERT_VALIDITY_YEARS = 10;
/** RSA modulus length — 2048 bit is what every Hue client accepts. */
const CERT_KEY_BITS = 2048;

/**
 * Generate a self-signed certificate for HTTPS.
 *
 * v1.4.3 (M5): RFC 5280 wants unique serial numbers across reissues — 16 random
 * bytes (positive, MSB cleared) is the standard approach.
 *
 * @returns the PEM certificate and its private key.
 */
export function generateCertificate(): TlsMaterial {
  const keys = forge.pki.rsa.generateKeyPair(CERT_KEY_BITS);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  const serialBytes = randomBytes(16);
  serialBytes[0] &= 0x7f;
  cert.serialNumber = serialBytes.toString("hex");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + CERT_VALIDITY_YEARS);

  const attrs = [
    { name: "commonName", value: "Philips Hue" },
    { name: "countryName", value: "NL" },
    { name: "organizationName", value: "Philips Hue" },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return { cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) };
}

/**
 * True when both PEM blocks look like what they claim to be. A cheap shape
 * check before the expensive parse.
 *
 * @param cert The persisted certificate, trimmed.
 * @param key The persisted private key, trimmed.
 */
function looksLikePem(cert: string, key: string): boolean {
  return (
    cert.startsWith("-----BEGIN CERTIFICATE-----") &&
    (key.startsWith("-----BEGIN RSA PRIVATE KEY-----") || key.startsWith("-----BEGIN PRIVATE KEY-----"))
  );
}

/**
 * v1.4.3 (M1+M3+M5): reuse the self-signed TLS material persisted in `native`
 * so it survives restarts. Real Hue clients (Echo, Harmony, Wall Display) don't
 * pin the cert — but regenerating on each restart wasted ~1–2 s of synchronous
 * RSA keygen on the event loop and gave clients a fresh certificate warning
 * every time.
 *
 * v1.4.5 (B): the persisted certificate is parsed and its validity window
 * checked before reuse. Matching the BEGIN header alone let an expired or
 * corrupted certificate through to Fastify, where it failed the HTTPS listen
 * far from the cause.
 *
 * @param adapter Minimal adapter surface (namespace + persist + log).
 * @param persistedCert The `native.tlsCert` value, whatever type it has.
 * @param persistedKey The `native.tlsKey` value, whatever type it has.
 * @returns the material to serve, and whether it was newly persisted.
 */
export async function getOrCreateTlsMaterial(
  adapter: TlsMaterialAdapter,
  persistedCert: unknown,
  persistedKey: unknown,
): Promise<TlsMaterialResult> {
  const cert = typeof persistedCert === "string" ? persistedCert.trim() : "";
  const key = typeof persistedKey === "string" ? persistedKey.trim() : "";

  if (looksLikePem(cert, key)) {
    try {
      const parsed = forge.pki.certificateFromPem(cert);
      if (parsed.validity.notAfter > new Date()) {
        adapter.log.debug(`Reusing persisted TLS certificate (notAfter=${parsed.validity.notAfter.toISOString()})`);
        return { cert, key, persisted: false };
      }
      adapter.log.warn(
        `Persisted TLS certificate expired (notAfter=${parsed.validity.notAfter.toISOString()}) — regenerating`,
      );
    } catch (err) {
      adapter.log.warn(`Persisted TLS certificate invalid (${errText(err)}) — regenerating`);
    }
    // fall through to regenerate
  }

  adapter.log.debug("Generating self-signed certificate for HTTPS");
  const generated = generateCertificate();
  try {
    await adapter.extendForeignObjectAsync(`system.adapter.${adapter.namespace}`, {
      native: { tlsCert: generated.cert, tlsKey: generated.key },
    });
    adapter.log.info(`Generated and persisted self-signed TLS certificate (${CERT_VALIDITY_YEARS}-year validity)`);
    return { ...generated, persisted: true };
  } catch (err) {
    adapter.log.warn(`TLS cert generated but failed to persist: ${errText(err)} — will regenerate next restart`);
    return { ...generated, persisted: false };
  }
}
