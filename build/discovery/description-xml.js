"use strict";
/**
 * UPnP Description XML Generator for Hue Bridge Emulation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDescriptionXml = generateDescriptionXml;
exports.getDescriptionUrl = getDescriptionUrl;
/**
 * Generate the UPnP description.xml content for Hue bridge discovery
 */
function generateDescriptionXml(options) {
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
function getDescriptionUrl(host, port) {
    return `http://${host}:${port}/description.xml`;
}
