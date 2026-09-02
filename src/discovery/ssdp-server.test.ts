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
    membership: string[];
    ttl: number[];
    closed: boolean;
    unrefed: boolean;
    sent: Array<{ text: string; port: number; address: string }>;
    handlers: Record<string, Array<(...a: unknown[]) => void>>;
    once: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    on: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    removeListener: (ev: string, cb: (...a: unknown[]) => void) => FakeSocket;
    bind: (port: number, cb?: () => void) => FakeSocket;
    addMembership: (addr: string, iface?: string) => void;
    setMulticastTTL: (ttl: number) => void;
    send: (...args: unknown[]) => void;
    close: () => void;
    unref: () => void;
    emit: (ev: string, ...args: unknown[]) => void;
  }
  const sockets: FakeSocket[] = [];
  const fail = { bind: false, join: false, ttl: false, send: false, holdSendCallbacks: false };
  const heldSendCallbacks: Array<() => void> = [];
  const make = (): FakeSocket => {
    const s: FakeSocket = {
      bound: [],
      membership: [],
      ttl: [],
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
        s.bound.push(port);
        if (fail.bind) {
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
      setMulticastTTL: ttl => {
        if (fail.ttl) {
          throw new Error("EBADF");
        }
        s.ttl.push(ttl);
      },
      send: (...args) => {
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
  const interfaces: Record<string, Array<{ address: string; family: string; internal: boolean }>> = {};
  return { sockets, make, fail, heldSendCallbacks, interfaces };
});

vi.mock("node:dgram", () => ({ createSocket: () => h.make() }));
vi.mock("node:os", () => ({ networkInterfaces: () => h.interfaces }));

type LogFn = (message: string) => void;

function spyLogger(): Logger & Record<"debug" | "warn" | "error", Mock<LogFn>> {
  return { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), error: vi.fn<LogFn>() };
}

const identity = createTestIdentity();
const BRIDGE = { bridgeId: identity.bridgeId, location: "http://192.168.1.100:8080/description.xml" };
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

function makeServer(logger = spyLogger(), onFatalError?: () => void): HueSsdpServer {
  return new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger, onFatalError });
}

describe("HueSsdpServer", () => {
  beforeEach(() => {
    h.sockets.length = 0;
    h.heldSendCallbacks.length = 0;
    Object.keys(h.fail).forEach(k => ((h.fail as Record<string, boolean>)[k] = false));
    Object.keys(h.interfaces).forEach(k => delete h.interfaces[k]);
    h.interfaces.lo0 = [{ address: "127.0.0.1", family: "IPv4", internal: true }];
    h.interfaces.en0 = [
      { address: "192.168.1.100", family: "IPv4", internal: false },
      { address: "fe80::1", family: "IPv6", internal: false },
    ];
    h.interfaces.en1 = [{ address: "10.0.0.5", family: "IPv4", internal: false }];
    vi.clearAllMocks();
  });

  describe("start", () => {
    it("binds UDP port 1900 by default and honours a custom ssdpPort", async () => {
      await makeServer().start();
      expect(h.sockets[0].bound).toEqual([SSDP_PORT]);

      const custom = new HueSsdpServer({ identity, host: "10.0.0.1", port: 80, ssdpPort: 1901, logger: spyLogger() });
      await custom.start();
      expect(h.sockets[1].bound).toEqual([1901]);
    });

    it("joins the multicast group on every routable IPv4 interface (node-ssdp behavior)", async () => {
      await makeServer().start();
      expect(h.sockets[0].membership).toEqual(["192.168.1.100", "10.0.0.5"]);
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

    it("rejects and logs when the bind fails (port busy) — no hang, the H1 fix", async () => {
      h.fail.bind = true;
      const logger = spyLogger();
      await expect(makeServer(logger).start()).rejects.toThrow(/EADDRINUSE/);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to start SSDP server"));
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
      await server.start();
      expect(h.sockets).toHaveLength(1);
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
  });

  describe("announce", () => {
    it("sends one alive NOTIFY per target to the multicast group", async () => {
      const server = makeServer();
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

    it("is a no-op before start and after stop", async () => {
      const server = makeServer();
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
    it("sends the byebye NOTIFYs node-ssdp always lost, then closes the socket", async () => {
      const server = makeServer();
      await server.start();

      await server.stop();

      const socket = h.sockets[0];
      expect(socket.sent).toEqual(
        TABLE.map(entry => ({
          text: buildByeNotify(entry, identity.bridgeId),
          port: SSDP_PORT,
          address: "239.255.255.250",
        })),
      );
      expect(socket.closed).toBe(true);
    });

    it("closes only after the last byebye send has called back — the datagram must not lose the race", async () => {
      h.fail.holdSendCallbacks = true;
      const server = makeServer();
      await server.start();

      const stopped = server.stop();
      const socket = h.sockets[0];
      expect(socket.closed).toBe(false);

      h.heldSendCallbacks.forEach(invoke => invoke());
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
      const server = makeServer(spyLogger(), vi.fn());
      await server.start();
      const socket = h.sockets[0];

      socket.emit("error", new Error("EBADF"));
      server.announce();

      expect(socket.sent).toEqual([]);
    });
  });
});
