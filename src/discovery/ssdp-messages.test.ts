/**
 * Tests for the pure SSDP message helpers. Every expected datagram below is a
 * verbatim wire capture of node-ssdp 4.0.1 running with this adapter's exact
 * options (2026-08-24, see dev-history) — the rewrite must stay byte-identical
 * so proven-compatible clients (Harmony, Alexa, Hue apps) see no difference.
 */

import {
  HUE_SERVER_SIGNATURE,
  buildAliveNotify,
  buildByeNotify,
  buildSearchResponse,
  buildUsnTable,
  matchSearch,
  parseMSearchTarget,
} from "./ssdp-messages";

/** The identity used in the reference capture. */
const UDN = "2f402f80-da50-11e1-9b23-00178824c126";
const BRIDGE = {
  bridgeId: "001788FFFE24C126",
  location: "http://192.0.2.10:8080/description.xml",
};
const DATE_UTC = "Mon, 24 Aug 2026 20:13:28 GMT";

function msearch(lines: string[]): string {
  return lines.concat(["", ""]).join("\r\n");
}

/** A well-formed M-SEARCH for the given search target, as real clients send it. */
function msearchFor(st: string): string {
  return msearch(["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"', "MX: 3", `ST: ${st}`]);
}

describe("buildUsnTable", () => {
  it("registers the four notification targets node-ssdp advertised", () => {
    expect(buildUsnTable(UDN)).toEqual([
      {
        nt: "urn:schemas-upnp-org:device:Basic:1",
        usn: `uuid:${UDN}::urn:schemas-upnp-org:device:Basic:1`,
      },
      {
        nt: "urn:schemas-upnp-org:device:basic:1",
        usn: `uuid:${UDN}::urn:schemas-upnp-org:device:basic:1`,
      },
      { nt: "upnp:rootdevice", usn: `uuid:${UDN}::upnp:rootdevice` },
      { nt: `uuid:${UDN}`, usn: `uuid:${UDN}` },
    ]);
  });
});

describe("parseMSearchTarget", () => {
  it("extracts the search target from a well-formed M-SEARCH", () => {
    expect(parseMSearchTarget(msearchFor("upnp:rootdevice"))).toBe("upnp:rootdevice");
  });

  it("unwraps a quoted search target (captured: quoted rootdevice was answered unquoted)", () => {
    expect(parseMSearchTarget(msearchFor('"upnp:rootdevice"'))).toBe("upnp:rootdevice");
  });

  it("ignores a datagram without the MX header (captured: node-ssdp stayed silent)", () => {
    const msg = msearch(["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"', "ST: upnp:rootdevice"]);
    expect(parseMSearchTarget(msg)).toBeUndefined();
  });

  it("ignores a datagram without the MAN header (captured: node-ssdp stayed silent)", () => {
    const msg = msearch(["M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", "MX: 3", "ST: upnp:rootdevice"]);
    expect(parseMSearchTarget(msg)).toBeUndefined();
  });

  it("ignores a NOTIFY datagram", () => {
    const msg = msearch(["NOTIFY * HTTP/1.1", "HOST: 239.255.255.250:1900", "NTS: ssdp:alive"]);
    expect(parseMSearchTarget(msg)).toBeUndefined();
  });

  it("ignores an HTTP response datagram (another responder's answer)", () => {
    const msg = msearch(["HTTP/1.1 200 OK", "ST: upnp:rootdevice", "USN: uuid:x"]);
    expect(parseMSearchTarget(msg)).toBeUndefined();
  });

  it("matches the method case-insensitively like node-ssdp did", () => {
    expect(parseMSearchTarget(msearchFor("ssdp:all").replace("M-SEARCH", "m-search"))).toBe("ssdp:all");
  });

  it("tolerates header names in any case", () => {
    const msg = msearch(["M-SEARCH * HTTP/1.1", "host: 239.255.255.250:1900", 'man: "ssdp:discover"', "mx: 3", "st: upnp:rootdevice"]);
    expect(parseMSearchTarget(msg)).toBe("upnp:rootdevice");
  });
});

describe("matchSearch", () => {
  const table = buildUsnTable(UDN);

  it.each([
    ["urn:schemas-upnp-org:device:Basic:1", `uuid:${UDN}::urn:schemas-upnp-org:device:Basic:1`],
    ["urn:schemas-upnp-org:device:basic:1", `uuid:${UDN}::urn:schemas-upnp-org:device:basic:1`],
    ["upnp:rootdevice", `uuid:${UDN}::upnp:rootdevice`],
    [`uuid:${UDN}`, `uuid:${UDN}`],
  ])("answers an exact search for %s with one response", (st, usn) => {
    expect(matchSearch(st, table)).toEqual([{ st, usn }]);
  });

  it("answers ssdp:all with all four targets, ST echoing each notification target", () => {
    expect(matchSearch("ssdp:all", table)).toEqual(table.map(entry => ({ st: entry.nt, usn: entry.usn })));
  });

  it("stays silent on an unknown search target (captured: no response to a DIAL search)", () => {
    expect(matchSearch("urn:dial-multiscreen-org:service:dial:1", table)).toEqual([]);
  });

  it("does NOT treat the search target as a pattern — a wildcard matches nothing", () => {
    // node-ssdp's allowWildcards (off here, and gone in the rewrite) built a RegExp
    // from this attacker-controlled value; plain equality is the ReDoS fix.
    expect(matchSearch("urn:schemas-upnp-org:device:*:1", table)).toEqual([]);
  });
});

describe("buildSearchResponse", () => {
  it("reproduces the captured node-ssdp response byte for byte", () => {
    const response = buildSearchResponse(
      {
        st: "urn:schemas-upnp-org:device:Basic:1",
        usn: `uuid:${UDN}::urn:schemas-upnp-org:device:Basic:1`,
      },
      BRIDGE,
      DATE_UTC,
    );
    expect(response).toBe(
      "HTTP/1.1 200 OK\r\n" +
        "ST: urn:schemas-upnp-org:device:Basic:1\r\n" +
        `USN: uuid:${UDN}::urn:schemas-upnp-org:device:Basic:1\r\n` +
        "CACHE-CONTROL: max-age=1800\r\n" +
        "DATE: Mon, 24 Aug 2026 20:13:28 GMT\r\n" +
        "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0\r\n" +
        "EXT: \r\n" +
        "hue-bridgeid: 001788FFFE24C126\r\n" +
        "LOCATION: http://192.0.2.10:8080/description.xml\r\n" +
        "\r\n",
    );
  });

  it("reproduces the captured uuid response (bare USN, no :: suffix)", () => {
    const response = buildSearchResponse({ st: `uuid:${UDN}`, usn: `uuid:${UDN}` }, BRIDGE, DATE_UTC);
    expect(response).toBe(
      "HTTP/1.1 200 OK\r\n" +
        `ST: uuid:${UDN}\r\n` +
        `USN: uuid:${UDN}\r\n` +
        "CACHE-CONTROL: max-age=1800\r\n" +
        "DATE: Mon, 24 Aug 2026 20:13:28 GMT\r\n" +
        "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0\r\n" +
        "EXT: \r\n" +
        "hue-bridgeid: 001788FFFE24C126\r\n" +
        "LOCATION: http://192.0.2.10:8080/description.xml\r\n" +
        "\r\n",
    );
  });
});

describe("buildAliveNotify", () => {
  it("reproduces the captured alive NOTIFY byte for byte", () => {
    const notify = buildAliveNotify(
      { nt: "upnp:rootdevice", usn: `uuid:${UDN}::upnp:rootdevice` },
      BRIDGE,
    );
    expect(notify).toBe(
      "NOTIFY * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        "NT: upnp:rootdevice\r\n" +
        "NTS: ssdp:alive\r\n" +
        `USN: uuid:${UDN}::upnp:rootdevice\r\n` +
        "LOCATION: http://192.0.2.10:8080/description.xml\r\n" +
        "CACHE-CONTROL: max-age=1800\r\n" +
        "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0\r\n" +
        "hue-bridgeid: 001788FFFE24C126\r\n" +
        "\r\n",
    );
  });
});

describe("buildByeNotify", () => {
  it("builds the byebye NOTIFY in node-ssdp's header layout (no location/cache/date)", () => {
    // Not wire-captured: node-ssdp 4.0.1 closed its sockets in the same tick it
    // queued the byebye, so the datagram never left the machine (verified
    // 2026-08-24). Layout derives from its source: HOST/NT/NTS/USN plus the
    // extra headers in option order (hue-bridgeid, then SERVER).
    const notify = buildByeNotify({ nt: "upnp:rootdevice", usn: `uuid:${UDN}::upnp:rootdevice` }, BRIDGE.bridgeId);
    expect(notify).toBe(
      "NOTIFY * HTTP/1.1\r\n" +
        "HOST: 239.255.255.250:1900\r\n" +
        "NT: upnp:rootdevice\r\n" +
        "NTS: ssdp:byebye\r\n" +
        `USN: uuid:${UDN}::upnp:rootdevice\r\n` +
        "hue-bridgeid: 001788FFFE24C126\r\n" +
        "SERVER: Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0\r\n" +
        "\r\n",
    );
  });
});

describe("HUE_SERVER_SIGNATURE", () => {
  it("is the IpBridge signature every datagram carries", () => {
    expect(HUE_SERVER_SIGNATURE).toBe("Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0");
  });
});
