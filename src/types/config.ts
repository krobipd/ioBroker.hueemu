/**
 * Configuration types for the Hue Emulator
 */

import { parsePort } from "../lib/coerce";
import type { SecureSetup } from "../lib/secure-server";
import { SettingsError } from "../lib/start-failure";

/**
 * The HTTPS listener beside HTTP: its port and the certificates of the fleet master (`loadCertificates`).
 */
export interface TlsConfig {
  /** HTTPS listening port */
  port: number;
  /** The certificates and the choice per name, as the fleet master secure-server.ts built them for this start */
  setup: SecureSetup;
}

/**
 * Bridge identity information
 */
export interface BridgeIdentity {
  /** Unique device name (UUID) */
  udn: string;
  /** MAC address of the bridge */
  mac: string;
  /** Bridge ID derived from MAC */
  bridgeId: string;
  /** Model ID */
  modelId: string;
  /** Serial number */
  serialNumber: string;
}

/**
 * Main configuration for the Hue Emulator
 */
export interface HueEmulatorConfig {
  /** Address to bind the server to (may be 0.0.0.0 to listen on all interfaces) */
  bind: string;
  /**
   * HTTP port (used both for binding and in the description URL). The address a client is
   * told comes per client — `ownAddressFor` of the fleet master network-address.ts (D17).
   */
  port: number;
  /** Optional HTTPS configuration */
  https?: TlsConfig;
  /** Bridge identity */
  identity: BridgeIdentity;
  /**
   * v1.4.3 (SV1): trust X-Forwarded-* headers from a reverse proxy.
   * Default false — only enable when the adapter sits behind a trusted
   * TLS-terminating proxy that strips client-supplied forwarding headers.
   */
  trustProxy: boolean;
}

/**
 * Logger interface compatible with ioBroker
 */
export interface Logger {
  /** Log a debug message */
  debug(message: string): void;
  /** Log an info message */
  info(message: string): void;
  /** Log a warning message */
  warn(message: string): void;
  /** Log an error message */
  error(message: string): void;
}

/** Hue Bridge model ID (BSB002 = Bridge v2) */
export const BRIDGE_MODEL_ID = "BSB002";

/**
 * Generate bridge ID from MAC address
 *
 * @param mac - MAC address to derive the bridge ID from
 */
export function generateBridgeId(mac: string): string {
  const cleanMac = mac.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  // Insert FFFE in the middle (standard for Hue bridge ID format)
  return `${cleanMac.slice(0, 6)}FFFE${cleanMac.slice(6)}`;
}

/**
 * Generate serial number from MAC address
 *
 * @param mac - MAC address to derive the serial number from
 */
export function generateSerialNumber(mac: string): string {
  // Strip every non-hex char (not just colons) so a hand-typed/garbled mac can
  // never put a metacharacter into the serial that feeds description.xml.
  return mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

/**
 * Derive a stable MAC address from the UDN (used when no MAC is configured).
 * Strips dashes, takes the first 12 hex chars (zero-padded if shorter), then
 * groups them into colon-separated pairs.
 *
 * @param udn - UUID to derive the MAC address from
 */
export function macFromUdn(udn: string): string {
  const hex = udn.replace(/-/g, "").slice(0, 12).padEnd(12, "0");
  const bytes = hex.match(/.{2}/g)!;
  // Force a locally-administered unicast MAC. A raw UUID slice lands on a
  // multicast first byte (I/G bit set) or a globally-administered one roughly
  // half the time — e.g. 0x65, which surfaced in the admin as 65:30:f5:41:ec:2e.
  // Clear the I/G bit (bit 0) so it is unicast, set the U/L bit (bit 1) so it is
  // marked locally administered.
  const first = (parseInt(bytes[0], 16) & 0xfe) | 0x02;
  bytes[0] = first.toString(16).padStart(2, "0");
  return bytes.join(":");
}

/**
 * The HTTPS port of this start: none while HTTPS is off (`native.secure`), whatever the field holds; while it is on the
 * port is required — without one there is nothing to listen on, a wrong setting (exit code 11 and a notification,
 * start-failure.ts). Its range is checked by {@link validateNetworkConfig}.
 *
 * @param secure - Whether HTTPS is on (the fleet master loaded its certificates).
 * @param raw - `native.httpsPort` as stored (a text up to now, a number from a hand-edited object).
 */
export function httpsPortOf(secure: boolean, raw: unknown): number | undefined {
  if (!secure) {
    return undefined;
  }
  const port = parsePort(raw);
  if (port === undefined) {
    throw new SettingsError(
      "HTTPS is on, but no HTTPS port is set — enter 443 (newer Echos try it) in the instance settings or switch HTTPS off",
    );
  }
  return port;
}

/**
 * Validate the resolved ports before the servers start. A port that is no port number, or an
 * HTTPS port that collides with the HTTP port (the second listen would otherwise fail later
 * with EADDRINUSE, far from the cause), is a wrong setting: a `SettingsError` that names what
 * to change (exit code 11 and a notification — start-failure.ts). Pure so the throw branches
 * are unit-testable without standing up the adapter.
 *
 * @param port - Resolved HTTP port.
 * @param httpsPort - Resolved HTTPS port, or undefined when HTTPS is off.
 */
export function validateNetworkConfig(port: number, httpsPort: number | undefined): void {
  // The admin form keeps a port within 1..65535; an instance object edited by
  // hand does not, and a listen() on port 0 or 70000 fails far from the cause.
  for (const [label, value] of [
    ["HTTP", port],
    ["HTTPS", httpsPort],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65535)) {
      throw new SettingsError(
        `${label} port ${value} is not a port number (1–65535) — enter a port from 1 to 65535 in the instance settings`,
      );
    }
  }
  if (httpsPort !== undefined && httpsPort === port) {
    throw new SettingsError(
      `HTTPS port ${httpsPort} equals HTTP port — choose a different HTTPS port in the instance settings`,
    );
  }
}
