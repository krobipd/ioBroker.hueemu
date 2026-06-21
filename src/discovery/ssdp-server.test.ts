/**
 * Tests for HueSsdpServer — server-option wiring, USN registration, lifecycle
 * and the diagnostic event hooks. node-ssdp itself is mocked: we own the
 * wiring (options built from identity/host/port, the three USNs, start/stop
 * state, the M-SEARCH "response" log), the protocol is the library's job.
 */

import { HueSsdpServer } from "./ssdp-server";
import { createTestIdentity } from "../../test/test-helpers";
import type { Logger } from "../types/config";

interface FakeInstance {
  opts: Record<string, unknown>;
  usns: string[];
  handlers: Record<string, (...args: unknown[]) => void>;
  stopCalls: number;
}

const h = vi.hoisted(() => ({
  instances: [] as FakeInstance[],
  control: { failNext: false },
}));

vi.mock("node-ssdp", () => {
  class FakeServer {
    public usns: string[] = [];
    public handlers: Record<string, (...args: unknown[]) => void> = {};
    public stopCalls = 0;
    constructor(public opts: Record<string, unknown>) {
      h.instances.push(this);
    }
    addUSN(usn: string): void {
      this.usns.push(usn);
    }
    on(event: string, cb: (...args: unknown[]) => void): void {
      this.handlers[event] = cb;
    }
    start(cb?: (err?: Error) => void): void {
      cb?.(h.control.failNext ? new Error("EADDRINUSE: port 1900 busy") : undefined);
    }
    stop(): void {
      this.stopCalls++;
    }
  }
  return { Server: FakeServer };
});

function spyLogger(): Logger & { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger & { debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
}

describe("HueSsdpServer", () => {
  const identity = createTestIdentity();

  beforeEach(() => {
    h.instances.length = 0;
    h.control.failNext = false;
  });

  it("builds server options from identity/host/port and registers the three USNs", async () => {
    const logger = spyLogger();
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger });
    await server.start();

    expect(h.instances).toHaveLength(1);
    const opts = h.instances[0].opts;
    expect(opts.location).toBe("http://192.168.1.100:8080/description.xml");
    expect(opts.sourcePort).toBe(1900); // default
    expect(opts.udn).toBe(`uuid:${identity.udn}`);
    expect((opts.headers as Record<string, string>)["hue-bridgeid"]).toBe(identity.bridgeId);
    expect(h.instances[0].usns).toEqual([
      "urn:schemas-upnp-org:device:Basic:1",
      "urn:schemas-upnp-org:device:basic:1",
      "upnp:rootdevice",
    ]);
  });

  it("disables wildcard M-SEARCH matching (ReDoS hardening) and drops the ttl option", async () => {
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger: spyLogger() });
    await server.start();
    const opts = h.instances[0].opts;
    expect(opts.allowWildcards).toBe(false);
    expect(opts.ttl).toBeUndefined();
  });

  it("honours a custom ssdpPort", async () => {
    const server = new HueSsdpServer({ identity, host: "10.0.0.1", port: 80, ssdpPort: 1901, logger: spyLogger() });
    await server.start();
    expect(h.instances[0].opts.sourcePort).toBe(1901);
  });

  it("logs the peer address on an M-SEARCH response", async () => {
    const logger = spyLogger();
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger });
    await server.start();

    h.instances[0].handlers["response"]({}, 200, { address: "10.0.0.5" });
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("10.0.0.5"));
  });

  it("falls back to '?' when the response peer has no address", async () => {
    const logger = spyLogger();
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger });
    await server.start();

    h.instances[0].handlers["response"]({}, 200, undefined);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("→ ?"));
  });

  it("stop() stops the underlying server", async () => {
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger: spyLogger() });
    await server.start();
    server.stop();
    expect(h.instances[0].stopCalls).toBe(1);
  });

  it("is idempotent — a second start() does not create a second server", async () => {
    const logger = spyLogger();
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger });
    await server.start();
    await server.start();
    expect(h.instances).toHaveLength(1);
    expect(logger.debug).toHaveBeenCalledWith("SSDP server already running");
  });

  it("rejects and logs when the underlying start fails (port busy)", async () => {
    h.control.failNext = true;
    const logger = spyLogger();
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger });
    await expect(server.start()).rejects.toThrow(/EADDRINUSE/);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to start SSDP server"));
  });

  it("stop() before start() is a no-op", () => {
    const server = new HueSsdpServer({ identity, host: "192.168.1.100", port: 8080, logger: spyLogger() });
    expect(() => server.stop()).not.toThrow();
  });
});
