"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var description_xml_exports = {};
__export(description_xml_exports, {
  generateDescriptionXml: () => generateDescriptionXml,
  getDescriptionUrl: () => getDescriptionUrl
});
module.exports = __toCommonJS(description_xml_exports);
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
function getDescriptionUrl(host, port) {
  return `http://${host}:${port}/description.xml`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateDescriptionXml,
  getDescriptionUrl
});
//# sourceMappingURL=description-xml.js.map
