/**
 * Configuration types for the Hue Emulator
 */

import { networkInterfaces } from "node:os";

/**
 * TLS/SSL configuration for HTTPS support
 */
export interface TlsConfig {
  /** HTTPS listening port */
  port: number;
  /** PEM-encoded certificate */
  cert: string;
  /** PEM-encoded private key */
  key: string;
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
  /** Host address to bind the server (may be 0.0.0.0 to listen on all interfaces) */
  host: string;
  /** HTTP port (used both for binding and for the advertised description URL) */
  port: number;
  /** Concrete IP advertised to clients (SSDP location / description.xml / config). Never 0.0.0.0. */
  advertiseHost: string;
  /** Optional HTTPS configuration */
  https?: TlsConfig;
  /** UPnP/SSDP port (default: 1900) */
  upnpPort: number;
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
  return hex.match(/.{2}/g)!.join(":");
}

/**
 * Best-effort primary IPv4 of the host — the first non-internal IPv4 interface.
 * Used as the advertised address when none is configured, so SSDP/description
 * announce a routable IP rather than the bind wildcard. Returns "" if none found.
 */
export function detectPrimaryIPv4(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node typed `family` as the string "IPv4" historically and as the number
      // 4 from v18 — accept both so detection works across runtimes.
      const isV4 = addr.family === "IPv4" || (addr.family as unknown as number) === 4;
      if (isV4 && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "";
}

/**
 * Validate the resolved network config before the servers start. Throws with a
 * user-actionable message when no routable IP could be resolved to advertise
 * (an empty/0.0.0.0 advertise address is not reachable by clients) or when the
 * HTTPS port collides with the HTTP port (the second listen would otherwise
 * fail later with EADDRINUSE, far from the cause). The bind host itself may be
 * empty/0.0.0.0 — that just means "listen on all interfaces". Pure so the throw
 * branches are unit-testable without standing up the adapter.
 *
 * @param advertiseHost - Resolved address advertised to clients (already trimmed).
 * @param port - Resolved HTTP port.
 * @param httpsPort - Resolved HTTPS port, or undefined when HTTPS is off.
 */
export function validateNetworkConfig(advertiseHost: string, port: number, httpsPort: number | undefined): void {
  if (!advertiseHost || advertiseHost === "0.0.0.0") {
    throw new Error(
      "Could not determine a routable IP to advertise — set the advertised IP in admin config to the address clients should reach",
    );
  }
  if (httpsPort !== undefined && httpsPort === port) {
    throw new Error(`HTTPS port ${httpsPort} equals HTTP port — pick a different port`);
  }
}
