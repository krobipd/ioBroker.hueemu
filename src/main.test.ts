/**
 * Orchestration tests for main.ts (HueEmu) — previously untested at 0 %.
 * Drives onReady/onStateChange/onUnload, buildConfig, the TLS lifecycle and
 * the legacy migrations through the makeHueServer/makeSsdpServer/
 * makeApiHandler seams, without binding real ports or generating real keys.
 */

import { vi } from "vitest";

// Stub the adapter-core base so HueEmu can be instantiated without the
// ioBroker runtime.
vi.mock("@iobroker/adapter-core", () => {
  class Adapter {
    public log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    public namespace = "hueemu.0";
    public adapterDir = "/tmp";
    public config: Record<string, unknown> = {};
    public on = vi.fn();
    public setState = vi.fn(async () => {});
    public setStateAsync = vi.fn(async () => ({ id: "x" }));
    public getStateAsync = vi.fn(async () => null);
    public setObjectNotExistsAsync = vi.fn(async () => ({ id: "x" }));
    public getObjectAsync = vi.fn(async () => null);
    public delObjectAsync = vi.fn(async () => {});
    public getObjectListAsync = vi.fn(async () => ({ rows: [] }));
    public getDevicesAsync = vi.fn(async () => []);
    public getStatesOfAsync = vi.fn(async () => []);
    public extendForeignObjectAsync = vi.fn(async () => {});
    public extendObjectAsync = vi.fn(async () => {});
    public subscribeStates = vi.fn();
    public setTimeout = vi.fn(() => ({}) as unknown);
    public clearTimeout = vi.fn();
    public setInterval = vi.fn(() => ({}) as unknown);
    public clearInterval = vi.fn();
    constructor(_opts: unknown) {}
  }
  return {
    Adapter,
    I18n: {
      init: vi.fn(async () => {}),
      getTranslatedObject: (k: string) => ({ en: k }),
      translate: (k: string) => k,
    },
  };
});

// Mock node-forge: real 2048-bit keygen takes ~1s per call and is not the
// unit under test — the BRANCHING around persist/expiry/corruption is.
const forgeControl = vi.hoisted(() => ({
  // What certificateFromPem reports for the persisted cert.
  notAfter: new Date("2090-01-01T00:00:00Z"),
  parseThrows: false,
}));
vi.mock("node-forge", () => ({
  pki: {
    rsa: { generateKeyPair: vi.fn(() => ({ publicKey: {}, privateKey: {} })) },
    createCertificate: vi.fn(() => ({
      publicKey: null,
      serialNumber: "",
      validity: { notBefore: new Date(), notAfter: new Date() },
      setSubject: vi.fn(),
      setIssuer: vi.fn(),
      sign: vi.fn(),
    })),
    certificateFromPem: vi.fn(() => {
      if (forgeControl.parseThrows) {
        throw new Error("malformed PEM");
      }
      return { validity: { notAfter: forgeControl.notAfter } };
    }),
    certificateToPem: vi.fn(() => "-----BEGIN CERTIFICATE-----\nGENERATED\n-----END CERTIFICATE-----"),
    privateKeyToPem: vi.fn(() => "-----BEGIN RSA PRIVATE KEY-----\nGENERATED\n-----END RSA PRIVATE KEY-----"),
  },
  md: { sha256: { create: vi.fn(() => ({})) } },
}));

import { HueEmu } from "./main";

interface FakeHueServer {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  options: unknown;
}

interface FakeSsdp {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
  options: unknown;
}

interface FakeApiHandler {
  initialize: ReturnType<typeof vi.fn>;
  onStateChange: ReturnType<typeof vi.fn>;
  resetAutoAddBudget: ReturnType<typeof vi.fn>;
  options: unknown;
}

/** Typed access to the private members the orchestration tests drive. */
function internalOf(adapter: HueEmu): {
  config: Record<string, unknown>;
  log: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  setState: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
  clearTimeout: ReturnType<typeof vi.fn>;
  setInterval: ReturnType<typeof vi.fn>;
  clearInterval: ReturnType<typeof vi.fn>;
  subscribeStates: ReturnType<typeof vi.fn>;
  extendForeignObjectAsync: ReturnType<typeof vi.fn>;
  getStateAsync: ReturnType<typeof vi.fn>;
  getObjectAsync: ReturnType<typeof vi.fn>;
  getObjectListAsync: ReturnType<typeof vi.fn>;
  getDevicesAsync: ReturnType<typeof vi.fn>;
  getStatesOfAsync: ReturnType<typeof vi.fn>;
  delObjectAsync: ReturnType<typeof vi.fn>;
  setObjectNotExistsAsync: ReturnType<typeof vi.fn>;
  setStateAsync: ReturnType<typeof vi.fn>;
  pairingTimeoutId: unknown;
  _pairingEnabled: boolean;
  _disableAuth: boolean;
  onReady: () => Promise<void>;
  onUnload: (cb: () => void) => void;
  onStateChange: (id: string, state: ioBroker.State | null | undefined) => void;
  buildConfig: () => Promise<{
    host: string;
    port: number;
    advertiseHost: string;
    identity: { udn: string; mac: string };
    https?: { cert: string; key: string };
  }>;
  getOrCreateTlsMaterial: () => Promise<{ cert: string; key: string }>;
  migrateLegacyDevices: () => Promise<boolean>;
  migrateUserToClients: () => Promise<void>;
} {
  return adapter as unknown as ReturnType<typeof internalOf>;
}

function setup(configOverrides: Record<string, unknown> = {}): {
  adapter: HueEmu;
  servers: FakeHueServer[];
  ssdps: FakeSsdp[];
  handlers: FakeApiHandler[];
} {
  const adapter = new HueEmu();
  const i = internalOf(adapter);
  Object.assign(i.config, {
    host: "192.168.1.10",
    port: 8080,
    advertiseHost: "",
    httpsPort: undefined,
    udn: "12345678-1234-1234-1234-123456789abc",
    mac: "AA:BB:CC:DD:EE:FF",
    devices: [],
    ...configOverrides,
  });

  const servers: FakeHueServer[] = [];
  const ssdps: FakeSsdp[] = [];
  const handlers: FakeApiHandler[] = [];
  const internal = adapter as unknown as {
    makeHueServer: (options: unknown) => FakeHueServer;
    makeSsdpServer: (options: unknown) => FakeSsdp;
    makeApiHandler: (options: unknown) => FakeApiHandler;
  };
  internal.makeHueServer = options => {
    const s: FakeHueServer = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), options };
    servers.push(s);
    return s;
  };
  internal.makeSsdpServer = options => {
    const s: FakeSsdp = { start: vi.fn(async () => {}), stop: vi.fn(), announce: vi.fn(), options };
    ssdps.push(s);
    return s;
  };
  internal.makeApiHandler = options => {
    const h: FakeApiHandler = {
      initialize: vi.fn(async () => {}),
      onStateChange: vi.fn(),
      resetAutoAddBudget: vi.fn(),
      options,
    };
    handlers.push(h);
    return h;
  };
  return { adapter, servers, ssdps, handlers };
}

beforeEach(() => {
  forgeControl.notAfter = new Date("2090-01-01T00:00:00Z");
  forgeControl.parseThrows = false;
});

const PERSISTED_CERT = "-----BEGIN CERTIFICATE-----\nPERSISTED\n-----END CERTIFICATE-----";
const PERSISTED_KEY = "-----BEGIN RSA PRIVATE KEY-----\nPERSISTED\n-----END RSA PRIVATE KEY-----";

describe("HueEmu buildConfig", () => {
  it("resolves host/ports and derives the bridge identity from UDN/MAC", async () => {
    const { adapter } = setup();
    const config = await internalOf(adapter).buildConfig();
    expect(config.host).toBe("192.168.1.10");
    expect(config.port).toBe(8080);
    expect(config.identity.udn).toBe("12345678-1234-1234-1234-123456789abc");
    expect(config.identity.mac).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("generates and persists UDN/MAC when not configured (stable identity)", async () => {
    const { adapter } = setup({ udn: "", mac: "" });
    const i = internalOf(adapter);
    const config = await i.buildConfig();
    expect(config.identity.udn).toMatch(/^[0-9a-f-]{36}$/i);
    expect(config.identity.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({ native: expect.objectContaining({ udn: config.identity.udn }) }),
    );
  });

  it("treats a blank host as bind-all and auto-resolves a routable advertise IP", async () => {
    const { adapter } = setup({ host: "  " });
    const config = await internalOf(adapter).buildConfig();
    expect(config.host).toBe("0.0.0.0");
    expect(config.advertiseHost).toBeTruthy();
    expect(config.advertiseHost).not.toBe("0.0.0.0");
  });

  it("advertises the explicit advertiseHost when set", async () => {
    const { adapter } = setup({ host: "0.0.0.0", advertiseHost: "10.1.2.3" });
    const config = await internalOf(adapter).buildConfig();
    expect(config.advertiseHost).toBe("10.1.2.3");
  });

  it("advertises a concrete bind host when advertiseHost is empty", async () => {
    const { adapter } = setup({ host: "192.168.5.5", advertiseHost: "" });
    const config = await internalOf(adapter).buildConfig();
    expect(config.advertiseHost).toBe("192.168.5.5");
  });

  it("throws when the HTTPS port equals the HTTP port", async () => {
    const { adapter } = setup({ httpsPort: 8080 });
    await expect(internalOf(adapter).buildConfig()).rejects.toThrow(/equals HTTP port/);
  });

  it("throws when the port is missing entirely", async () => {
    const { adapter } = setup({ port: undefined });
    await expect(internalOf(adapter).buildConfig()).rejects.toThrow(/Port not specified/);
  });

  it("builds the https block from persisted TLS material when httpsPort is set", async () => {
    const { adapter } = setup({ httpsPort: 8443, tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const config = await internalOf(adapter).buildConfig();
    expect(config.https).toEqual({ port: 8443, cert: PERSISTED_CERT, key: PERSISTED_KEY });
  });
});

describe("HueEmu TLS lifecycle (getOrCreateTlsMaterial)", () => {
  it("reuses a persisted, still-valid certificate without regenerating", async () => {
    const { adapter } = setup({ tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const i = internalOf(adapter);
    const material = await i.getOrCreateTlsMaterial();
    expect(material.cert).toBe(PERSISTED_CERT);
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled(); // nothing re-persisted
  });

  it("regenerates and persists when the persisted certificate is expired", async () => {
    forgeControl.notAfter = new Date("2020-01-01T00:00:00Z");
    const { adapter } = setup({ tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const i = internalOf(adapter);
    const material = await i.getOrCreateTlsMaterial();
    expect(material.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({ native: expect.objectContaining({ tlsCert: expect.stringContaining("GENERATED") }) }),
    );
  });

  it("regenerates when the persisted certificate fails to parse (corruption guard)", async () => {
    forgeControl.parseThrows = true;
    const { adapter } = setup({ tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const i = internalOf(adapter);
    const material = await i.getOrCreateTlsMaterial();
    expect(material.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("invalid"));
  });

  it("generates fresh material when nothing is persisted", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const material = await i.getOrCreateTlsMaterial();
    expect(material.cert).toContain("GENERATED");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("persisted self-signed TLS certificate"));
  });

  it("still returns the generated material when persisting fails (warn, retry next restart)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.extendForeignObjectAsync.mockRejectedValueOnce(new Error("db readonly"));
    const material = await i.getOrCreateTlsMaterial();
    expect(material.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("failed to persist"));
  });
});

describe("HueEmu onReady", () => {
  it("boots in order: handler init → HTTP start → SSDP start → subscribe", async () => {
    const { adapter, servers, ssdps, handlers } = setup();
    const i = internalOf(adapter);
    await i.onReady();

    expect(handlers).toHaveLength(1);
    expect(handlers[0].initialize).toHaveBeenCalledTimes(1);
    expect(servers).toHaveLength(1);
    expect(servers[0].start).toHaveBeenCalledTimes(1);
    expect(ssdps[0].start).toHaveBeenCalledTimes(1);
    // S2: HTTP before SSDP
    expect(servers[0].start.mock.invocationCallOrder[0]).toBeLessThan(ssdps[0].start.mock.invocationCallOrder[0]);
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Hue Emulator running"));
  });

  it("tolerates an SSDP start failure (port 1900 busy) — HTTP API stays up", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as { makeSsdpServer: (o: unknown) => FakeSsdp };
    const origFactory = internal.makeSsdpServer.bind(adapter);
    internal.makeSsdpServer = (o: unknown) => {
      const s = origFactory(o);
      s.start.mockRejectedValue(new Error("EADDRINUSE 1900"));
      return s;
    };
    await i.onReady();
    expect(ssdps[0].start).toHaveBeenCalled();
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("SSDP discovery disabled"));
    // H1: state handling must still be wired after an SSDP failure — the adapter
    // must not be left HTTP-alive-but-state-dead.
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Hue Emulator running"));
  });

  it("times out a hung SSDP start so onReady still wires state handling (H1)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as {
      makeSsdpServer: (o: unknown) => FakeSsdp;
      setTimeout: (cb: () => void, ms: number) => unknown;
    };
    const orig = internal.makeSsdpServer.bind(adapter);
    internal.makeSsdpServer = (o: unknown) => {
      const s = orig(o);
      // A start() that never settles — the old node-ssdp H1 hang, kept as the
      // worst case the defense-in-depth timeout bound must still win against.
      s.start.mockReturnValue(new Promise<void>(() => {}));
      return s;
    };
    // Fire the start-timeout synchronously so the hung start() loses the race.
    // onReady is the only this.setTimeout caller during boot (the pairing timer is
    // armed later, in onStateChange), so overriding it here is safe.
    internal.setTimeout = (cb: () => void) => {
      cb();
      return {};
    };
    await i.onReady();
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("SSDP discovery disabled"));
    // The timed-out SSDP start must NOT stall onReady — state handling stays wired.
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Hue Emulator running"));
  });

  it("announces right after SSDP start and pulses every 10 s on a managed interval", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    await i.onReady();

    // Immediate announce (node-ssdp's wake-up advertise) …
    expect(ssdps[0].announce).toHaveBeenCalledTimes(1);
    // … then the managed 10 s pulse (node-ssdp's adInterval, now adapter-owned).
    expect(i.setInterval).toHaveBeenCalledTimes(1);
    const [pulse, intervalMs] = i.setInterval.mock.calls[0] as [() => void, number];
    expect(intervalMs).toBe(10000);
    pulse();
    expect(ssdps[0].announce).toHaveBeenCalledTimes(2);
  });

  it("does not announce or arm the pulse when SSDP failed to start", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as { makeSsdpServer: (o: unknown) => FakeSsdp };
    const origFactory = internal.makeSsdpServer.bind(adapter);
    internal.makeSsdpServer = (o: unknown) => {
      const s = origFactory(o);
      s.start.mockRejectedValue(new Error("EADDRINUSE 1900"));
      return s;
    };
    await i.onReady();
    expect(ssdps[0].announce).not.toHaveBeenCalled();
    expect(i.setInterval).not.toHaveBeenCalled();
  });

  it("stops the announce pulse when the SSDP socket dies at runtime (onFatalError)", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    await i.onReady();

    const options = ssdps[0].options as { onFatalError?: () => void };
    expect(typeof options.onFatalError).toBe("function");
    options.onFatalError?.();

    expect(i.clearInterval).toHaveBeenCalledWith(i.setInterval.mock.results[0].value);
  });

  it("short-circuits after a legacy-device migration (adapter restarts on config write)", async () => {
    const { adapter, servers } = setup({ devices: [] });
    const i = internalOf(adapter);
    // One legacy device object with an `on` state child.
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.legacylight", common: { name: "Old Lamp" } }]);
    i.getStatesOfAsync.mockResolvedValue([{ _id: "hueemu.0.legacylight.state.on" }]);
    await i.onReady();

    // Migration persisted the device config…
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({
        native: expect.objectContaining({
          devices: [
            expect.objectContaining({ name: "Old Lamp", lightType: "onoff", onState: "hueemu.0.legacylight.state.on" }),
          ],
        }),
      }),
    );
    // …and the boot stopped before any server was constructed.
    expect(servers).toHaveLength(0);
  });

  it("short-circuits onReady after persisting a generated identity (restart imminent)", async () => {
    const { adapter, servers } = setup({ udn: "", mac: "" });
    const i = internalOf(adapter);
    await i.onReady();
    // Identity was generated + persisted…
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({ native: expect.objectContaining({ udn: expect.any(String) }) }),
    );
    // …and no server was built — the native write restarts the instance, which
    // re-runs onReady with the stored identity.
    expect(servers).toHaveLength(0);
  });

  it("catches a failing boot (e.g. invalid config) instead of crashing", async () => {
    const { adapter } = setup({ httpsPort: 8080 }); // httpsPort === port → buildConfig throws
    const i = internalOf(adapter);
    await i.onReady();
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to start Hue Emulator"));
  });

  it("restores disableAuth from the persisted state with strict bool coercion (M2+M4)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStateAsync.mockResolvedValue({ val: "false", ack: true }); // string "false" must NOT enable
    await i.onReady();
    expect(adapter.disableAuth).toBe(false);

    const on = setup();
    internalOf(on.adapter).getStateAsync.mockResolvedValue({ val: true, ack: true });
    await internalOf(on.adapter).onReady();
    expect(on.adapter.disableAuth).toBe(true);
  });

  it("restores disableAuth BEFORE the HTTP listener opens (L1: no boot-window auth gap)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStateAsync.mockResolvedValue({ val: true, ack: true }); // persisted disableAuth = true
    let disableAuthAtHttpStart: boolean | undefined;
    (adapter as unknown as { makeHueServer: (o: unknown) => unknown }).makeHueServer = (options: unknown) => ({
      start: vi.fn(async () => {
        disableAuthAtHttpStart = adapter.disableAuth;
      }),
      stop: vi.fn(async () => {}),
      options,
    });
    await i.onReady();
    // initializeAdapterStates() ran before hueServer.start(), so the persisted flag
    // was already live when the listener opened (old order captured the default false).
    expect(disableAuthAtHttpStart).toBe(true);
  });
});

describe("HueEmu onStateChange", () => {
  async function ready(overrides: Record<string, unknown> = {}): Promise<ReturnType<typeof setup>> {
    const ctx = setup(overrides);
    await internalOf(ctx.adapter).onReady();
    return ctx;
  }

  it("startPairing=true enables pairing, resets the auto-add budget and arms the 50s timeout", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);

    expect(adapter.pairingEnabled).toBe(true);
    expect(handlers[0].resetAutoAddBudget).toHaveBeenCalled();
    expect(i.setTimeout).toHaveBeenCalledWith(expect.any(Function), 50_000);
    expect(i.setState).toHaveBeenCalledWith("startPairing", { ack: true, val: true });
  });

  it("the pairing timeout disables pairing and acks startPairing=false", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);
    const timeoutCb = i.setTimeout.mock.calls.at(-1)![0] as () => void;
    timeoutCb();
    expect(adapter.pairingEnabled).toBe(false);
    expect(i.setState).toHaveBeenCalledWith("startPairing", { ack: true, val: false });
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("automatically disabled"));
  });

  it("startPairing=false disables pairing and clears the timeout", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);
    // onReady itself arms and clears timers — without this the assertion below
    // is already satisfied before the pairing timer is even armed.
    i.clearTimeout.mockClear();
    i.onStateChange("hueemu.0.startPairing", { val: false, ack: false } as ioBroker.State);
    expect(adapter.pairingEnabled).toBe(false);
    expect(i.clearTimeout).toHaveBeenCalledTimes(1);
  });

  it("disableAuth routes through strict bool coercion and acks", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.disableAuth", { val: "true", ack: false } as ioBroker.State);
    expect(adapter.disableAuth).toBe(true);
    i.onStateChange("hueemu.0.disableAuth", { val: "false", ack: false } as ioBroker.State);
    expect(adapter.disableAuth).toBe(false);
  });

  it("acks any other own non-acked state (generic echo)", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.something.else", { val: 42, ack: false } as ioBroker.State);
    expect(i.setState).toHaveBeenCalledWith("hueemu.0.something.else", { ack: true, val: 42 });
  });

  it("forwards acked changes into the API handler's state cache (device binding)", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hue.0.light.bri", { val: 80, ack: true } as ioBroker.State);
    expect(handlers[0].onStateChange).toHaveBeenCalledWith("hue.0.light.bri", 80);
    // Acked changes never trigger the command paths.
    expect(adapter.pairingEnabled).toBe(false);
  });

  it("does NOT feed an unacked write into the handler's state cache", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    // An unacked value is a COMMAND, not the device's answer. Caching it would
    // make the Hue client read back the wish instead of the fact: the lamp
    // shows as on while it never reacted.
    i.onStateChange("hue.0.light.bri", { val: 80, ack: false } as ioBroker.State);
    expect(handlers[0].onStateChange).not.toHaveBeenCalled();
  });

  it("does not ack an already-acked own state (no write feedback loop)", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.setState.mockClear();
    // Our own ack triggers onStateChange again — acking it once more is an
    // endless ping-pong between adapter and broker.
    i.onStateChange("hueemu.0.something.else", { val: 42, ack: true } as ioBroker.State);
    expect(i.setState).not.toHaveBeenCalled();
  });

  it("clears no timer when pairing was never armed", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.clearTimeout.mockClear();
    i.onStateChange("hueemu.0.startPairing", { val: false, ack: false } as ioBroker.State);
    // clearTimeout(undefined) is a no-op today, but adapter-core logs a warning
    // for an unknown handle — and the guard is what says "there is nothing to
    // clear" instead of relying on that.
    expect(i.clearTimeout).not.toHaveBeenCalled();
  });

  it("handles a deleted state without throwing", async () => {
    const { adapter } = await ready();
    expect(() => internalOf(adapter).onStateChange("hueemu.0.startPairing", null)).not.toThrow();
  });
});

describe("HueEmu onUnload", () => {
  it("clears the pairing timeout, stops SSDP + HTTP and always calls back", async () => {
    const { adapter, servers, ssdps } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);

    const callback = vi.fn();
    i.onUnload(callback);

    expect(i.clearTimeout).toHaveBeenCalled();
    // The announce pulse must not outlive the server (sync clear in onUnload).
    expect(i.clearInterval).toHaveBeenCalledWith(i.setInterval.mock.results[0].value);
    expect(ssdps[0].stop).toHaveBeenCalled();
    expect(servers[0].stop).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("still calls back when a stop throws", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    ssdps[0].stop.mockImplementation(() => {
      throw new Error("already stopped");
    });
    const callback = vi.fn();
    i.onUnload(callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("Error during shutdown"));
  });

  it("is safe before onReady (no servers constructed yet)", () => {
    const { adapter } = setup();
    const callback = vi.fn();
    internalOf(adapter).onUnload(callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("HueEmu migrateUserToClients (v1.2.0 rename)", () => {
  it("moves user.* states to clients.* (sanitized) and removes the old folder", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation(async (id: string) => (id === "user" ? { type: "meta" } : null));
    i.getObjectListAsync.mockResolvedValue({
      rows: [
        {
          id: "hueemu.0.user.alexa.echo",
          value: { common: { name: "Echo", type: "string", role: "text", read: true, write: false }, native: {} },
        },
      ],
    });
    i.getStateAsync.mockResolvedValue({ val: "alexa.echo", ack: true });

    await i.migrateUserToClients();

    expect(i.setObjectNotExistsAsync).toHaveBeenCalledWith("clients.alexa_echo", expect.anything());
    expect(i.setStateAsync).toHaveBeenCalledWith("clients.alexa_echo", { val: "alexa.echo", ack: true });
    expect(i.delObjectAsync).toHaveBeenCalledWith("user.alexa.echo");
    expect(i.delObjectAsync).toHaveBeenCalledWith("user");
  });

  it("is a no-op when no user folder exists", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.migrateUserToClients();
    expect(i.delObjectAsync).not.toHaveBeenCalled();
  });
});

describe("HueEmu migrateLegacyDevices", () => {
  it("returns false when devices are already configured", async () => {
    const { adapter } = setup({ devices: [{ name: "X", lightType: "onoff" }] });
    expect(await internalOf(adapter).migrateLegacyDevices()).toBe(false);
  });

  it("returns false when there are no legacy device objects", async () => {
    const { adapter } = setup();
    expect(await internalOf(adapter).migrateLegacyDevices()).toBe(false);
  });

  it("maps legacy state children to the right light type and state ids", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.colorlamp", common: { name: "Color Lamp" } }]);
    i.getStatesOfAsync.mockResolvedValue([
      { _id: "hueemu.0.colorlamp.state.on" },
      { _id: "hueemu.0.colorlamp.state.bri" },
      { _id: "hueemu.0.colorlamp.state.hue" },
      { _id: "hueemu.0.colorlamp.state.sat" },
    ]);

    expect(await i.migrateLegacyDevices()).toBe(true);
    const persisted = i.extendForeignObjectAsync.mock.calls.at(-1)![1] as {
      native: { devices: Array<Record<string, unknown>> };
    };
    const device = persisted.native.devices[0];
    expect(device.lightType).toBe("color");
    expect(device.onState).toBe("hueemu.0.colorlamp.state.on");
    expect(device.hueState).toBe("hueemu.0.colorlamp.state.hue");
    expect(device.xyState).toBeUndefined(); // xy not present in legacy states
  });

  it("keeps the device + channel container objects, deleting only the obsolete .name/.data wrappers (L2)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.legacylamp", common: { name: "Legacy" } }]);
    i.getStatesOfAsync.mockResolvedValue([{ _id: "hueemu.0.legacylamp.state.on" }]);

    expect(await i.migrateLegacyDevices()).toBe(true);

    const deleted = i.delObjectAsync.mock.calls.map((c) => c[0]);
    // Obsolete metadata wrappers are removed...
    expect(deleted).toContain("legacylamp.name");
    expect(deleted).toContain("legacylamp.data");
    // ...but the parents of the retained leaf states must NOT be orphaned.
    expect(deleted).not.toContain("legacylamp.state");
    expect(deleted).not.toContain("legacylamp");
  });
});
