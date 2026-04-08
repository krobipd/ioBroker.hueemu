/**
 * Configuration types for the Hue Emulator
 */

/**
 * TLS/SSL configuration for HTTPS support
 */
export interface TlsConfig {
  port: number;
  cert: string;
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
}

/**
 * Logger interface compatible with ioBroker
 */
export interface Logger {
  silly(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Generate bridge ID from MAC address
 */
export function generateBridgeId(mac: string): string {
  const cleanMac = mac.replace(/:/g, "").toUpperCase();
  // Insert FFFE in the middle (standard for Hue bridge ID format)
  return `${cleanMac.slice(0, 6)}FFFE${cleanMac.slice(6)}`;
}

/**
 * Generate serial number from MAC address
 */
export function generateSerialNumber(mac: string): string {
  return mac.replace(/:/g, "").toLowerCase();
}
