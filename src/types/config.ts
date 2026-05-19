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
