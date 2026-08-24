/**
 * Pure SSDP message helpers for Hue bridge discovery — no sockets, so every
 * datagram is unit-testable (fakeroku's ssdp-messages pattern). The socket
 * wiring lives in ssdp-server.ts.
 *
 * Every format here is byte-identical to what node-ssdp 4.0.1 produced with
 * this adapter's options (wire-captured 2026-08-24) — proven compatible with
 * Harmony, Alexa and the Hue apps, so the replacement must not drift.
 */

/** Where the bridge's description.xml lives and how it identifies itself. */
export interface SsdpAdvertisedBridge {
  /** Hue bridge id, sent as the non-standard `hue-bridgeid` header. */
  bridgeId: string;
  /** Absolute URL of description.xml, sent as LOCATION. */
  location: string;
}

/** One advertised target: notification type (= search target) and its USN. */
export interface SsdpTarget {
  /** Notification/search target, e.g. "upnp:rootdevice". */
  nt: string;
  /** Unique service name for that target. */
  usn: string;
}

/** One M-SEARCH answer: the ST to echo and the USN to report. */
export interface SsdpSearchAnswer {
  /** Search target the response echoes. */
  st: string;
  /** Unique service name for that target. */
  usn: string;
}

/** The SERVER signature a real Hue bridge (BSB002) sends. */
export const HUE_SERVER_SIGNATURE = "Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0";

/** SSDP multicast group — fixed by the UPnP standard. */
export const SSDP_MULTICAST_ADDR = "239.255.255.250";

/** Cache lifetime advertised in every datagram (node-ssdp's default, kept). */
const MAX_AGE = 1800;

const MSEARCH_METHOD = "m-search";

/**
 * The four targets the bridge advertises and answers for: the Basic:1 device
 * type in both casings (Harmony Hub searches lowercase), the UPnP root device,
 * and the bare device UUID (node-ssdp registered it implicitly on start).
 *
 * @param udn - Bridge UUID without the `uuid:` prefix
 * @returns the targets in node-ssdp's registration order
 */
export function buildUsnTable(udn: string): SsdpTarget[] {
  const uuid = `uuid:${udn}`;
  return [
    { nt: "urn:schemas-upnp-org:device:Basic:1", usn: `${uuid}::urn:schemas-upnp-org:device:Basic:1` },
    { nt: "urn:schemas-upnp-org:device:basic:1", usn: `${uuid}::urn:schemas-upnp-org:device:basic:1` },
    { nt: "upnp:rootdevice", usn: `${uuid}::upnp:rootdevice` },
    { nt: uuid, usn: uuid },
  ];
}

/**
 * Extract the search target from a datagram, applying node-ssdp's acceptance
 * rules: the method must be M-SEARCH (case-insensitive) and the MAN, MX and ST
 * headers must all be present (captured: a search without MX or MAN got no
 * answer). A quoted target is unwrapped — the response echoes it unquoted.
 *
 * @param message - Raw datagram text
 * @returns the search target, or undefined when the datagram is not an
 *   answerable M-SEARCH
 */
export function parseMSearchTarget(message: string): string | undefined {
  const lines = message.split("\r\n");
  const method = (lines[0] ?? "").split(" ")[0].toLowerCase();
  if (method !== MSEARCH_METHOD) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) {
      headers[match[1].toUpperCase()] = match[2];
    }
  }
  if (!headers.MAN || !headers.MX || !headers.ST) {
    return undefined;
  }
  let st = headers.ST;
  if (st.startsWith('"') && st.endsWith('"') && st.length >= 2) {
    st = st.slice(1, -1);
  }
  return st;
}

/**
 * Decide which responses a search target earns: `ssdp:all` gets every target
 * (ST echoing each notification type), an exact match gets that one target,
 * anything else gets silence. Plain string equality by design — node-ssdp's
 * wildcard mode built a RegExp from this attacker-controlled value (ReDoS).
 *
 * @param st - The (unquoted) search target
 * @param table - The advertised targets from {@link buildUsnTable}
 * @returns the answers to send, possibly empty
 */
export function matchSearch(st: string, table: SsdpTarget[]): SsdpSearchAnswer[] {
  if (st === "ssdp:all") {
    return table.map(entry => ({ st: entry.nt, usn: entry.usn }));
  }
  return table.filter(entry => entry.nt === st).map(entry => ({ st, usn: entry.usn }));
}

/**
 * Build the 200-OK answer to an M-SEARCH, in node-ssdp's exact header layout.
 *
 * @param answer - The ST/USN pair from {@link matchSearch}
 * @param bridge - Location and bridge id to advertise
 * @param dateUtc - Timestamp for the DATE header (`new Date().toUTCString()`)
 * @returns the response datagram text
 */
export function buildSearchResponse(answer: SsdpSearchAnswer, bridge: SsdpAdvertisedBridge, dateUtc: string): string {
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
    "",
  ].join("\r\n");
}

/**
 * Build the periodic ssdp:alive NOTIFY for one target.
 *
 * @param target - The NT/USN pair from {@link buildUsnTable}
 * @param bridge - Location and bridge id to advertise
 * @returns the NOTIFY datagram text
 */
export function buildAliveNotify(target: SsdpTarget, bridge: SsdpAdvertisedBridge): string {
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
    "",
  ].join("\r\n");
}

/**
 * Build the ssdp:byebye NOTIFY for one target (sent on shutdown). Header set
 * per node-ssdp's source: no LOCATION/CACHE-CONTROL/SERVER base headers, then
 * the extra headers in option order — node-ssdp itself never got this datagram
 * onto the wire (it closed its sockets in the same tick), so sending it at all
 * is the rewrite's improvement.
 *
 * @param target - The NT/USN pair from {@link buildUsnTable}
 * @param bridgeId - Bridge id for the `hue-bridgeid` header
 * @returns the NOTIFY datagram text
 */
export function buildByeNotify(target: SsdpTarget, bridgeId: string): string {
  return [
    "NOTIFY * HTTP/1.1",
    "HOST: 239.255.255.250:1900",
    `NT: ${target.nt}`,
    "NTS: ssdp:byebye",
    `USN: ${target.usn}`,
    `hue-bridgeid: ${bridgeId}`,
    `SERVER: ${HUE_SERVER_SIGNATURE}`,
    "",
    "",
  ].join("\r\n");
}
