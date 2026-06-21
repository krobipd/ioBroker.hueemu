/**
 * UPnP Description XML Generator for Hue Bridge Emulation
 */

import type { BridgeIdentity } from "../types/config";

/**
 * Options for generating the description XML
 */
export interface DescriptionXmlOptions {
  /** Bridge identity information */
  identity: BridgeIdentity;
  /** Host address */
  host: string;
  /** HTTP port */
  port: number;
  /** URL base override (optional) */
  urlBase?: string;
}

/**
 * Minimal XML escaping for interpolated values. Applied to every value that can
 * originate from configuration — host/urlBase and the mac-derived
 * serialNumber/udn — so a stray metacharacter cannot break or inject XML.
 *
 * @param s - Raw string to escape.
 */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate the UPnP description.xml content for Hue bridge discovery
 *
 * @param options - Description XML generation options
 */
export function generateDescriptionXml(options: DescriptionXmlOptions): string {
  const { identity, host, port, urlBase } = options;
  const baseUrl = urlBase || `http://${host}:${port}/`;
  const safeHost = escapeXml(host);
  const safeBaseUrl = escapeXml(baseUrl);
  // serialNumber derives from the admin-typed `mac` (free text), udn from a
  // uuid/persisted value — escape both as well, not just host/urlBase.
  const safeSerial = escapeXml(identity.serialNumber);
  const safeUdn = escapeXml(identity.udn);

  return `<?xml version="1.0" encoding="UTF-8" ?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
    <specVersion>
        <major>1</major>
        <minor>0</minor>
    </specVersion>
    <URLBase>${safeBaseUrl}</URLBase>
    <device>
        <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
        <friendlyName>Philips hue (${safeHost})</friendlyName>
        <manufacturer>Signify</manufacturer>
        <manufacturerURL>http://www.philips-hue.com</manufacturerURL>
        <modelDescription>Philips hue Personal Wireless Lighting</modelDescription>
        <modelName>Philips hue bridge 2015</modelName>
        <modelNumber>BSB002</modelNumber>
        <modelURL>http://www.philips-hue.com</modelURL>
        <serialNumber>${safeSerial}</serialNumber>
        <UDN>uuid:${safeUdn}</UDN>
        <presentationURL>index.html</presentationURL>
        <iconList>
            <icon>
                <mimetype>image/png</mimetype>
                <height>48</height>
                <width>48</width>
                <depth>24</depth>
                <url>hue_logo_0.png</url>
            </icon>
        </iconList>
    </device>
</root>`;
}

/**
 * Get SSDP location URL for the description.xml
 *
 * @param host - Bridge host address
 * @param port - HTTP port number
 */
export function getDescriptionUrl(host: string, port: number): string {
  return `http://${host}:${port}/description.xml`;
}
