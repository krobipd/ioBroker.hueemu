/**
 * UPnP Description XML Generator for Hue Bridge Emulation
 */

import type { BridgeIdentity } from '../types/config';

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
 * Generate the UPnP description.xml content for Hue bridge discovery
 */
export function generateDescriptionXml(options: DescriptionXmlOptions): string {
    const { identity, host, port, urlBase } = options;
    const baseUrl = urlBase || `http://${host}:${port}/`;

    return `<?xml version="1.0" encoding="UTF-8" ?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
    <specVersion>
        <major>1</major>
        <minor>0</minor>
    </specVersion>
    <URLBase>${baseUrl}</URLBase>
    <device>
        <deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
        <friendlyName>Philips hue (${host})</friendlyName>
        <manufacturer>Signify</manufacturer>
        <manufacturerURL>http://www.philips-hue.com</manufacturerURL>
        <modelDescription>Philips hue Personal Wireless Lighting</modelDescription>
        <modelName>Philips hue bridge 2015</modelName>
        <modelNumber>BSB002</modelNumber>
        <modelURL>http://www.philips-hue.com</modelURL>
        <serialNumber>${identity.serialNumber}</serialNumber>
        <UDN>uuid:${identity.udn}</UDN>
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
 */
export function getDescriptionUrl(host: string, port: number): string {
    return `http://${host}:${port}/description.xml`;
}

/**
 * Generate SSDP headers for the Hue bridge
 */
export function generateSsdpHeaders(identity: BridgeIdentity, host: string, port: number): Record<string, string> {
    return {
        'CACHE-CONTROL': 'max-age=100',
        'EXT': '',
        'LOCATION': getDescriptionUrl(host, port),
        'SERVER': 'Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0',
        'hue-bridgeid': identity.bridgeId,
        'ST': 'urn:schemas-upnp-org:device:Basic:1',
        'USN': `uuid:${identity.udn}::urn:schemas-upnp-org:device:Basic:1`
    };
}
