/**
 * Tests for HueSsdpServer — the dgram socket wiring around the pure message
 * helpers: bind/membership lifecycle, M-SEARCH answering, the announce pulse,
 * byebye-then-close on stop, and the runtime socket-death path. dgram and os
 * are mocked (fakeroku's responder-test pattern) so no real port is touched.
 */

import { HueSsdpServer, SSDP_PORT } from "./ssdp-server";
import { buildAliveNotify, buildByeNotify, buildSearchResponse, buildUsnTable } from "./ssdp-messages";
import { createTestIdentity } from "../../test/test-helpers";
import type { Logger } from "../types/config";
import type { Mock } from "vitest";

const h = vi.hoisted(() => {
  interface FakeSocket {
    bound: number[];
    boundTo: string[];
    membership: string[];
    ttl: number[];
    closed: boolean;
    unrefed: boolean;
    sent: Array<{ text: string; port: number; address: string }>;
    handlers: Record<string, Array<(...a: unknown[]) => void>>;
    once: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    on: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    removeListener: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    bind: (port: number | { address: string; port: number }, cb?: () => void) => FakeSocket;
    addMembership: (addr: string, iface?: string) => void;
    setMulticastInterface: (iface: string) => void;
    multicastIf: string[];
    setMulticastTTL: (ttl: number) => void;
    send: (...args: unknown[]) => void;
    close: () => void;
    unref: () => void;
    emit: (ev: string, ...args: unknown[]) => void;
  }
  const sockets: FakeSocket[] = [];
  const fail = {
    bind: false,
    senderBind: "",
    join: false,
    ttl: false,
    send: false,
    sendThrows: false,
    holdSendCallbacks: false,
  };
  const heldSendCallbacks: Array<() => void> = [];
  const make = (): FakeSocket => {
    const s: FakeSocket = {
      bound: [],
      boundTo: [],
      membership: [],
      ttl: [],
      multicastIf: [],
      sent: [],
      closed: false,
      unrefed: false,
      handlers: {},
      once: (ev, cb) => s.on(ev, cb),
      on: (ev, cb) => {
        (s.handlers[ev] ??= []).push(cb);
        return s;
      },
      removeListener: (ev, cb) => {
        s.handlers[ev] = (s.handlers[ev] ?? []).filter(x => x !== cb);
        return s;
      },
      bind: (port, cb) => {
        s.bound.push(typeof port === "number" ? port : port.port);
        if (typeof port !== "number") {
          s.boundTo.push(port.address);
        }
        if (fail.bind || (typeof port !== "number" && port.address === fail.senderBind)) {
          s.emit("error", new Error("EADDRINUSE: port 1900 busy"));
        } else {
          cb?.();
        }
        return s;
      },
      addMembership: (_addr, iface) => {
        if (fail.join) {
          throw new Error("ENODEV");
        }
        s.membership.push(iface ?? "default");
      },
      setMulticastInterface: iface => {
        s.multicastIf.push(iface);
      },
      setMulticastTTL: ttl => {
        if (fail.ttl) {
          throw new Error("EBADF");
        }
        s.ttl.push(ttl);
      },
      send: (...args) => {
        if (fail.sendThrows) {
          // What node's dgram does synchronously for a port it refuses (ERR_SOCKET_BAD_PORT).
          throw new RangeError("Port should be > 0 and < 65536. Received type number (0).");
        }
        const cb = args[args.length - 1];
        if (!fail.send) {
          s.sent.push({ text: String(args[0]), port: args[1] as number, address: args[2] as string });
        }
        if (typeof cb === "function") {
          const invoke = (): void => (cb as (e?: Error) => void)(fail.send ? new Error("ENETUNREACH") : undefined);
          if (fail.holdSendCallbacks) {
            heldSendCallbacks.push(invoke);
          } else {
            invoke();
          }
        }
      },
      close: () => {
        s.closed = true;
      },
      unref: () => {
        s.unrefed = true;
      },
      emit: (ev, ...args) => {
        (s.handlers[ev] ?? []).forEach(x => x(...args));
      },
    };
    sockets.push(s);
    return s;
  };
  const interfaces: Record<string, Array<{ address: string; family: string; internal: boolean; cidr?: string }>> = {};
  return { sockets, make, fail, heldSendCallbacks, interfaces };
});

vi.mock("node:dgram", () => ({ createSocket: () => h.make() }));
vi.mock("node:os", () => ({ networkInterfaces: () => h.interfaces }));

type LogFn = (message: string) => void;

function spyLogger(): Logger & Record<"debug" | "warn" | "error", Mock<LogFn>> {
  return { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() };
}

const identity = createTestIdentity();
// D17 (krobi 2026-11-11 19:34, fleet master network-address.ts): the bridge names to each client the host's address
// in that client's network — a client in 10.0.0.0/24 gets 10.0.0.5, one in 192.168.1.0/24 gets 192.168.1.100.
const BRIDGE = { bridgeId: identity.bridgeId, location: "http://10.0.0.5:8080/description.xml" };
const BRIDGE_LAN = { bridgeId: identity.bridgeId, location: "http://192.168.1.100:8080/description.xml" };
const TABLE = buildUsnTable(identity.udn);
const MSEARCH_BASIC = [
  "M-SEARCH * HTTP/1.1",
  "HOST: 239.255.255.250:1900",
  'MAN: "ssdp:discover"',
  "MX: 3",
  "ST: urn:schemas-upnp-org:device:Basic:1",
  "",
  "",
].join("\r\n");

function makeServer(
  logger = spyLogger(),
  onFatalError?: () => void,
  network: { bindIp?: string; isClientAllowed?: (address: string | undefined) => boolean } = {},
): HueSsdpServer {
  return new HueSsdpServer({
    identity,
    port: 8080,
    logger,
    onFatalError,
    bindIp: network.bindIp,
    isClientAllowed: network.isClientAllowed ?? (() => true),
  });
}

describe("HueSsdpServer", () => {
  beforeEach(() => {
    h.sockets.length = 0;
    h.heldSendCallbacks.length = 0;
    Object.keys(h.fail).forEach(k => ((h.fail as Record<string, boolean | string>)[k] = false));
    h.fail.senderBind = "";
    Object.keys(h.interfaces).forEach(k => delete h.interfaces[k]);
    h.interfaces.lo0 = [{ address: "127.0.0.1", family: "IPv4", internal: true, cidr: "127.0.0.1/8" }];
    h.interfaces.en0 = [
      { address: "192.168.1.100", family: "IPv4", internal: false, cidr: "192.168.1.100/24" },
      { address: "fe80::1", family: "IPv6", internal: false, cidr: "fe80::1/64" },
    ];
    h.interfaces.en1 = [{ address: "10.0.0.5", family: "IPv4", internal: false, cidr: "10.0.0.5/24" }];
    vi.clearAllMocks();
  });

  describe("start", () => {
    it("binds UDP port 1900", async () => {
      await makeServer().start();
      expect(h.sockets[0].bound).toEqual([SSDP_PORT]);
    });

    it("joins the multicast group on every routable IPv4 interface (node-ssdp behavior)", async () => {
      await makeServer().start();
      expect(h.sockets[0].membership).toEqual(["192.168.1.100", "10.0.0.5"]);
    });

    // krobi 2026-10-03 (fleet master network-address.ts): a chosen address is the only one the
    // adapter listens and sends on — the group is joined there, and the NOTIFYs leave from there.
    it("joins the group only on the chosen address and multicasts from it", async () => {
      await makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" }).start();
      expect(h.sockets[0].membership).toEqual(["10.0.0.5"]);
      expect(h.sockets[0].multicastIf).toEqual(["10.0.0.5"]);
    });

    it("leaves the outgoing interface to the system when every address is chosen", async () => {
      await makeServer().start();
      expect(h.sockets[0].multicastIf).toEqual([]);
    });

    it("sets the multicast TTL to 4 and unrefs the socket like node-ssdp did", async () => {
      await makeServer().start();
      expect(h.sockets[0].ttl).toEqual([4]);
      expect(h.sockets[0].unrefed).toBe(true);
    });

    it("closes the socket whose bind failed — no open handle left behind", async () => {
      h.fail.bind = true;
      await expect(makeServer().start()).rejects.toThrow(/EADDRINUSE/);
      expect(h.sockets[0].closed).toBe(true);
    });

    // The caller says it once, as a warning: discovery off, HTTP still serving — an error
    // line here on top of it told the same failure twice (review R-25).
    it("rejects without a log line of its own when the bind fails (port busy) — no hang, the H1 fix", async () => {
      h.fail.bind = true;
      const logger = spyLogger();
      await expect(makeServer(logger).start()).rejects.toThrow(/EADDRINUSE/);
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("survives a membership join failure with a warning — one bad interface must not kill discovery", async () => {
      h.fail.join = true;
      const logger = spyLogger();
      await makeServer(logger).start();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("multicast join failed"));
    });

    it("falls back to the OS default membership when no routable IPv4 interface exists", async () => {
      Object.keys(h.interfaces).forEach(k => delete h.interfaces[k]);
      await makeServer().start();
      expect(h.sockets[0].membership).toEqual(["default"]);
    });

    it("is idempotent — a second start() does not create a second socket", async () => {
      const logger = spyLogger();
      const server = makeServer(logger);
      await server.start();
      const opened = h.sockets.length;
      await server.start();
      expect(h.sockets).toHaveLength(opened);
      expect(logger.debug).toHaveBeenCalledWith("SSDP server already running");
    });
  });

  describe("M-SEARCH answering", () => {
    beforeEach(() => {
      vi.useFakeTimers({ now: new Date("2026-08-24T20:13:28Z") });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // The trust boundary decides first: a peer it refuses gets no answer even from a network the host is in.
    it("answers no search from a peer outside the adapter's networks", async () => {
      const logger = spyLogger();
      const server = makeServer(logger, undefined, { isClientAllowed: address => address !== "10.0.0.9" });
      await server.start();
      const socket = h.sockets[0];

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.9", port: 51000 });
      expect(socket.sent).toEqual([]);

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51000 });
      expect(socket.sent).toHaveLength(1);
    });

    it("answers a Basic:1 search with the captured node-ssdp response, unicast to the asker", async () => {
      const logger = spyLogger();
      const server = makeServer(logger);
      await server.start();
      const socket = h.sockets[0];

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51000 });

      expect(socket.sent).toEqual([
        {
          text: buildSearchResponse(
            { st: "urn:schemas-upnp-org:device:Basic:1", usn: TABLE[0].usn },
            BRIDGE,
            new Date().toUTCString(),
          ),
          port: 51000,
          address: "10.0.0.7",
        },
      ]);
      expect(logger.debug).toHaveBeenCalledWith("SSDP M-SEARCH response → 10.0.0.7");
    });

    it("names to each client the host's address in that client's network (D17)", async () => {
      const server = makeServer();
      await server.start();
      const socket = h.sockets[0];

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "192.168.1.20", port: 51000 });
      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51001 });

      const dateUtc = new Date().toUTCString();
      const answer = { st: "urn:schemas-upnp-org:device:Basic:1", usn: TABLE[0].usn };
      expect(socket.sent).toEqual([
        { text: buildSearchResponse(answer, BRIDGE_LAN, dateUtc), port: 51000, address: "192.168.1.20" },
        { text: buildSearchResponse(answer, BRIDGE, dateUtc), port: 51001, address: "10.0.0.7" },
      ]);
    });

    it("names the chosen address to a client in its network and answers no client outside it", async () => {
      const server = makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" });
      await server.start();
      const socket = h.sockets[0];

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "192.168.1.20", port: 51000 });
      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51001 });

      expect(socket.sent.map(x => x.address)).toEqual(["10.0.0.7"]);
      expect(socket.sent[0].text).toContain("LOCATION: http://10.0.0.5:8080/description.xml");
    });

    it("answers no client in no network of the host, even one the trust boundary lets through", async () => {
      const server = makeServer();
      await server.start();
      const socket = h.sockets[0];

      socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "172.16.0.9", port: 51000 });

      expect(socket.sent).toEqual([]);
    });

    it("answers ssdp:all with all four targets", async () => {
      const server = makeServer();
      await server.start();
      const socket = h.sockets[0];

      socket.emit(
        "message",
        Buffer.from(MSEARCH_BASIC.replace("ST: urn:schemas-upnp-org:device:Basic:1", "ST: ssdp:all"), "ascii"),
        {
          address: "10.0.0.7",
          port: 51000,
        },
      );

      expect(socket.sent.map(x => x.text)).toEqual(
        TABLE.map(entry => buildSearchResponse({ st: entry.nt, usn: entry.usn }, BRIDGE, new Date().toUTCString())),
      );
    });

    it("stays silent on an unknown search target and on non-M-SEARCH datagrams", async () => {
      const server = makeServer();
      await server.start();
      const socket = h.sockets[0];

      socket.emit(
        "message",
        Buffer.from(
          MSEARCH_BASIC.replace("ST: urn:schemas-upnp-org:device:Basic:1", "ST: urn:other:device:X:1"),
          "ascii",
        ),
        {
          address: "10.0.0.7",
          port: 51000,
        },
      );
      socket.emit("message", Buffer.from("NOTIFY * HTTP/1.1\r\nNTS: ssdp:alive\r\n\r\n", "ascii"), {
        address: "10.0.0.8",
        port: 1900,
      });

      expect(socket.sent).toEqual([]);
    });

    it("logs but survives a failed response send", async () => {
      h.fail.send = true;
      const logger = spyLogger();
      const server = makeServer(logger);
      await server.start();

      h.sockets[0].emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51000 });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("response send failed"));
    });

    // v1.19.0 (audit 2026-09-25 H1): source port 0 is legal on the wire (RFC 768); node's
    // `send` refuses it synchronously, and the throw inside the socket handler used to
    // end the process. Such a datagram is dropped before anything is sent.
    it("drops a search from source port 0 instead of letting send throw", async () => {
      const server = makeServer();
      await server.start();
      const socket = h.sockets[0];
      expect(() =>
        socket.emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 0 }),
      ).not.toThrow();
      expect(socket.sent).toEqual([]);
    });

    it("survives a send that throws synchronously", async () => {
      h.fail.sendThrows = true;
      const logger = spyLogger();
      const server = makeServer(logger);
      await server.start();
      expect(() =>
        h.sockets[0].emit("message", Buffer.from(MSEARCH_BASIC, "ascii"), { address: "10.0.0.7", port: 51000 }),
      ).not.toThrow();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("not sent"));
    });

    it("drops an oversized datagram unread", async () => {
      const server = makeServer();
      await server.start();
      const big = MSEARCH_BASIC.replace("MX: 3", `MX: 3\r\nX-PAD: ${"a".repeat(3000)}`);
      h.sockets[0].emit("message", Buffer.from(big, "ascii"), { address: "10.0.0.7", port: 51000 });
      expect(h.sockets[0].sent).toEqual([]);
    });
  });

  describe("announce", () => {
    it("sends one alive NOTIFY per target with the chosen address to the multicast group", async () => {
      const server = makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" });
      await server.start();

      server.announce();

      expect(h.sockets[0].sent).toEqual(
        TABLE.map(entry => ({
          text: buildAliveNotify(entry, BRIDGE),
          port: SSDP_PORT,
          address: "239.255.255.250",
        })),
      );
    });

    // D17 (Werkbank text of 2026-11-15): a NOTIFY has no asker — without a chosen address it goes out once per own
    // network, from a sender bound to that network's address and pinned to its interface, naming that address.
    it("sends the NOTIFYs once per own network without a chosen address, each from and naming its address", async () => {
      const server = makeServer();
      await server.start();

      server.announce();

      const [receiver, lan, other] = h.sockets;
      expect(receiver.sent).toEqual([]);
      expect({ bound: lan.boundTo, pinned: lan.multicastIf, ttl: lan.ttl }).toEqual({
        bound: ["192.168.1.100"],
        pinned: ["192.168.1.100"],
        ttl: [4],
      });
      expect(other.boundTo).toEqual(["10.0.0.5"]);
      expect(other.multicastIf).toEqual(["10.0.0.5"]);
      expect(lan.sent).toEqual(
        TABLE.map(entry => ({
          text: buildAliveNotify(entry, BRIDGE_LAN),
          port: SSDP_PORT,
          address: "239.255.255.250",
        })),
      );
      expect(other.sent).toEqual(
        TABLE.map(entry => ({ text: buildAliveNotify(entry, BRIDGE), port: SSDP_PORT, address: "239.255.255.250" })),
      );
    });

    it("opens no sender of its own with a chosen address", async () => {
      await makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" }).start();
      expect(h.sockets).toHaveLength(1);
    });

    it("keeps announcing in the other networks when one sender cannot open", async () => {
      h.fail.senderBind = "192.168.1.100";
      const logger = spyLogger();
      const server = makeServer(logger);
      await server.start();

      server.announce();

      const [, lan, other] = h.sockets;
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("SSDP sender on 192.168.1.100 could not open"));
      expect(lan.closed).toBe(true);
      expect(lan.sent).toEqual([]);
      expect(other.sent).toHaveLength(TABLE.length);
    });

    it("is a no-op before start and after stop", async () => {
      const server = makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" });
      server.announce();
      expect(h.sockets).toHaveLength(0);

      await server.start();
      await server.stop();
      const sentAfterStop = h.sockets[0].sent.length;
      server.announce();
      expect(h.sockets[0].sent).toHaveLength(sentAfterStop);
    });
  });

  describe("stop", () => {
    const BYE = TABLE.map(entry => ({
      text: buildByeNotify(entry, identity.bridgeId),
      port: SSDP_PORT,
      address: "239.255.255.250",
    }));

    it("sends the byebye NOTIFYs node-ssdp always lost, then closes the socket", async () => {
      const server = makeServer(spyLogger(), undefined, { bindIp: "10.0.0.5" });
      await server.start();

      await server.stop();

      const socket = h.sockets[0];
      expect(socket.sent).toEqual(BYE);
      expect(socket.closed).toBe(true);
    });

    it("says goodbye in every own network through its sender, then closes every socket", async () => {
      const server = makeServer();
      await server.start();

      await server.stop();

      const [receiver, lan, other] = h.sockets;
      expect({ receiver: receiver.sent, lan: lan.sent, other: other.sent }).toEqual({
        receiver: [],
        lan: BYE,
        other: BYE,
      });
      expect(h.sockets.map(socket => socket.closed)).toEqual([true, true, true]);
    });

    it("says goodbye through the receiving socket when the host has no network of its own", async () => {
      Object.keys(h.interfaces).forEach(k => delete h.interfaces[k]);
      const server = makeServer();
      await server.start();

      await server.stop();

      expect(h.sockets).toHaveLength(1);
      expect(h.sockets[0].sent).toEqual(BYE);
    });

    it("closes only after the last byebye send has called back — the datagram must not lose the race", async () => {
      h.fail.holdSendCallbacks = true;
      const server = makeServer();
      await server.start();

      const stopped = server.stop();
      const socket = h.sockets[0];
      expect(socket.closed).toBe(false);

      // Every byebye but the last has called back: still open.
      h.heldSendCallbacks.slice(0, -1).forEach(invoke => invoke());
      expect(socket.closed).toBe(false);

      h.heldSendCallbacks.at(-1)?.();
      await stopped;
      expect(socket.closed).toBe(true);
    });

    it("is idempotent and safe before start", async () => {
      const server = makeServer();
      await expect(server.stop()).resolves.toBeUndefined();

      await server.start();
      await server.stop();
      const sent = h.sockets[0].sent.length;
      await server.stop();
      expect(h.sockets[0].sent).toHaveLength(sent);
    });
  });

  describe("runtime socket death", () => {
    it("logs, closes and notifies onFatalError exactly once", async () => {
      const logger = spyLogger();
      const onFatal = vi.fn();
      const server = makeServer(logger, onFatal);
      await server.start();
      const socket = h.sockets[0];

      socket.emit("error", new Error("EBADF"));
      socket.emit("error", new Error("EBADF"));

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("SSDP socket error"));
      expect(socket.closed).toBe(true);
      expect(onFatal).toHaveBeenCalledTimes(1);
    });

    it("announce() after a socket death is a no-op", async () => {
      const server = makeServer(spyLogger(), vi.fn(), { bindIp: "10.0.0.5" });
      await server.start();
      const socket = h.sockets[0];

      socket.emit("error", new Error("EBADF"));
      server.announce();

      expect(socket.sent).toEqual([]);
    });
  });
});
