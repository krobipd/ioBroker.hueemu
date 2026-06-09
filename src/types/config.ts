/**
 * Configuration types for the Hue Emulator
 */

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
  /** Host address to bind the server */
  host: string;
  /** HTTP port */
  port: number;
  /** Discovery host for SSDP announcements */
  discoveryHost: string;
  /** Discovery port */
  discoveryPort: number;
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
  const cleanMac = mac.replace(/:/g, "").toUpperCase();
  // Insert FFFE in the middle (standard for Hue bridge ID format)
  return `${cleanMac.slice(0, 6)}FFFE${cleanMac.slice(6)}`;
}

/**
 * Generate serial number from MAC address
 *
 * @param mac - MAC address to derive the serial number from
 */
export function generateSerialNumber(mac: string): string {
  return mac.replace(/:/g, "").toLowerCase();
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
 * Validate the resolved network config before the servers start. Throws with a
 * user-actionable message when the bridge host is empty (SSDP would advertise
 * an empty location and Fastify would bind 0.0.0.0 — clients can't reach the
 * bridge) or when the HTTPS port collides with the HTTP port (the second
 * listen would otherwise fail later with EADDRINUSE, far from the cause).
 * Pure so the throw branches are unit-testable without standing up the adapter.
 *
 * @param host - Resolved bridge host (already trimmed).
 * @param port - Resolved HTTP port.
 * @param httpsPort - Resolved HTTPS port, or undefined when HTTPS is off.
 */
export function validateNetworkConfig(host: string, port: number, httpsPort: number | undefined): void {
  if (!host) {
    throw new Error("Bridge host is empty — set 'host' in admin config to the IP that clients should reach");
  }
  if (httpsPort !== undefined && httpsPort === port) {
    throw new Error(`HTTPS port ${httpsPort} equals HTTP port — pick a different port`);
  }
}
