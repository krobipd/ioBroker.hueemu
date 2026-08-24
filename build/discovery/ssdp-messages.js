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
var ssdp_messages_exports = {};
__export(ssdp_messages_exports, {
  HUE_SERVER_SIGNATURE: () => HUE_SERVER_SIGNATURE,
  SSDP_MULTICAST_ADDR: () => SSDP_MULTICAST_ADDR,
  buildAliveNotify: () => buildAliveNotify,
  buildByeNotify: () => buildByeNotify,
  buildSearchResponse: () => buildSearchResponse,
  buildUsnTable: () => buildUsnTable,
  matchSearch: () => matchSearch,
  parseMSearchTarget: () => parseMSearchTarget
});
module.exports = __toCommonJS(ssdp_messages_exports);
const HUE_SERVER_SIGNATURE = "Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0";
const SSDP_MULTICAST_ADDR = "239.255.255.250";
const MAX_AGE = 1800;
const MSEARCH_METHOD = "m-search";
function buildUsnTable(udn) {
  const uuid = `uuid:${udn}`;
  return [
    { nt: "urn:schemas-upnp-org:device:Basic:1", usn: `${uuid}::urn:schemas-upnp-org:device:Basic:1` },
    { nt: "urn:schemas-upnp-org:device:basic:1", usn: `${uuid}::urn:schemas-upnp-org:device:basic:1` },
    { nt: "upnp:rootdevice", usn: `${uuid}::upnp:rootdevice` },
    { nt: uuid, usn: uuid }
  ];
}
function parseMSearchTarget(message) {
  var _a;
  const lines = message.split("\r\n");
  const method = ((_a = lines[0]) != null ? _a : "").split(" ")[0].toLowerCase();
  if (method !== MSEARCH_METHOD) {
    return void 0;
  }
  const headers = {};
  for (const line of lines.slice(1)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) {
      headers[match[1].toUpperCase()] = match[2];
    }
  }
  if (!headers.MAN || !headers.MX || !headers.ST) {
    return void 0;
  }
  let st = headers.ST;
  if (st.startsWith('"') && st.endsWith('"') && st.length >= 2) {
    st = st.slice(1, -1);
  }
  return st;
}
function matchSearch(st, table) {
  if (st === "ssdp:all") {
    return table.map((entry) => ({ st: entry.nt, usn: entry.usn }));
  }
  return table.filter((entry) => entry.nt === st).map((entry) => ({ st, usn: entry.usn }));
}
function buildSearchResponse(answer, bridge, dateUtc) {
  return [
    "HTTP/1.1 200 OK",
    `ST: ${answer.st}`,
    `USN: ${answer.usn}`,
    `CACHE-CONTROL: max-age=${MAX_AGE}`,
    `DATE: ${dateUtc}`,
    `SERVER: ${HUE_SERVER_SIGNATURE}`,
    "EXT: ",
    `hue-bridgeid: ${bridge.bridgeId}`,
    `LOCATION: ${bridge.location}`,
    "",
    ""
  ].join("\r\n");
}
function buildAliveNotify(target, bridge) {
  return [
    "NOTIFY * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    `NT: ${target.nt}`,
    "NTS: ssdp:alive",
    `USN: ${target.usn}`,
    `LOCATION: ${bridge.location}`,
    `CACHE-CONTROL: max-age=${MAX_AGE}`,
    `SERVER: ${HUE_SERVER_SIGNATURE}`,
    `hue-bridgeid: ${bridge.bridgeId}`,
    "",
    ""
  ].join("\r\n");
}
function buildByeNotify(target, bridgeId) {
  return [
    "NOTIFY * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    `NT: ${target.nt}`,
    "NTS: ssdp:byebye",
    `USN: ${target.usn}`,
    `hue-bridgeid: ${bridgeId}`,
    `SERVER: ${HUE_SERVER_SIGNATURE}`,
    "",
    ""
  ].join("\r\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HUE_SERVER_SIGNATURE,
  SSDP_MULTICAST_ADDR,
  buildAliveNotify,
  buildByeNotify,
  buildSearchResponse,
  buildUsnTable,
  matchSearch,
  parseMSearchTarget
});
//# sourceMappingURL=ssdp-messages.js.map
