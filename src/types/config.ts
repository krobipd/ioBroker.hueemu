/**
 * Configuration types for the Hue Emulator
 */

import { networkInterfaces } from "node:os";
import { ConfigurationError } from "./errors";

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
 * Interface names that carry a container, a VM or a tunnel rather than the LAN.
 * An address on one of them is routable in Node's sense and useless to a Hue
 * client on the network — announcing it means Alexa never finds the bridge, and
 * nothing in the log says why (audit 2026-09-06 F7).
 */
const VIRTUAL_IFACE_RE = /^(docker|br-|veth|virbr|vmnet|vboxnet|tun|tap|utun|wg|zt|tailscale|ham|lo)/i;

/** One routable IPv4 address together with the interface it belongs to. */
export interface IPv4Address {
  /** Interface name, e.g. "eth0". */
  iface: string;
  /** Dotted-quad address. */
  address: string;
  /** Whether the interface name looks like a container/VM/tunnel device. */
  virtual: boolean;
}

/**
 * Every non-internal IPv4 address of the host, in the order the OS reports them.
 *
 * The single source for both callers — the advertised address and the SSDP
 * multicast join. They used to walk `networkInterfaces()` separately, and only
 * one of them handled the numeric `family` form, so the other would silently
 * have found nothing (audit 2026-09-06 F8).
 */
export function listIPv4Addresses(): IPv4Address[] {
  const found: IPv4Address[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node typed `family` as the string "IPv4" historically and as the number
      // 4 from v18 — accept both so detection works across runtimes.
      const isV4 = addr.family === "IPv4" || (addr.family as unknown as number) === 4;
      if (isV4 && !addr.internal) {
        found.push({ iface, address: addr.address, virtual: VIRTUAL_IFACE_RE.test(iface) });
      }
    }
  }
  return found;
}

/**
 * Best-effort primary IPv4 of the host, used as the advertised address when the
 * config says "listen on all interfaces". SSDP and description.xml must name an
 * address a client can actually reach, so a real network interface always wins
 * over a docker bridge or a VPN tunnel; a host that has nothing else falls back
 * to whatever there is. Returns "" if there is no non-internal IPv4 at all.
 */
export function detectPrimaryIPv4(): string {
  const addresses = listIPv4Addresses();
  return (addresses.find(a => !a.virtual) ?? addresses[0])?.address ?? "";
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
    throw new ConfigurationError(
      "Could not determine a routable IP to advertise — set the Host/IP in admin config to the concrete address clients should reach",
    );
  }
  if (httpsPort !== undefined && httpsPort === port) {
    throw new ConfigurationError(`HTTPS port ${httpsPort} equals HTTP port — pick a different port`);
  }
}
