/**
 * Orchestration tests for main.ts (HueEmu) — previously untested at 0 %.
 * Drives onReady/onStateChange/onUnload, buildConfig, the TLS lifecycle and
 * the legacy migrations through the makeHueServer/makeSsdpServer/
 * makeApiHandler seams, without binding real ports or generating real keys.
 */

import { readFileSync } from "node:fs";
import type * as os from "node:os";
import type * as tls from "node:tls";
import { join } from "node:path";
import { vi } from "vitest";

/** The options the adapter hands to adapter-core — recorded by the stub. */
const adapterOptions = vi.hoisted((): { last: unknown } => ({ last: undefined }));

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
    public getStateAsync = vi.fn(() => Promise.resolve(null));
    public setObjectNotExistsAsync = vi.fn(() => Promise.resolve({ id: "x" }));
    public setForeignObject = vi.fn(() => Promise.resolve({ id: "x" }));
    public getObjectAsync = vi.fn(() => Promise.resolve(null));
    public delObjectAsync = vi.fn(async () => {});
    public getObjectListAsync = vi.fn(() => Promise.resolve({ rows: [] }));
    public getDevicesAsync = vi.fn(() => Promise.resolve([]));
    public getStatesOfAsync = vi.fn(() => Promise.resolve([]));
    public extendForeignObjectAsync = vi.fn(async () => {});
    public getForeignObjectAsync = vi.fn((): Promise<unknown> => Promise.resolve(null));
    public extendObjectAsync = vi.fn(async () => {});
    public extendObject = vi.fn(async () => {});
    public subscribeStates = vi.fn();
    public setTimeout = vi.fn(() => ({}));
    public clearTimeout = vi.fn();
    public setInterval = vi.fn(() => ({}));
    public clearInterval = vi.fn();
    // js-controller's own form is `$/aes-192-cbc:<iv>:<ciphertext>` — the prefix is what
    // its start-up decryption keys on; anything without it is decrypted as garbage.
    public encrypt = vi.fn((v: string) => `$/aes-192-cbc:ENC(${v})`);
    constructor(opts: unknown) {
      adapterOptions.last = opts;
    }
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

// node:os passes through except for a fixed interface list: the advertise
// address the adapter picks must be one the TEST decides on, not whatever the
// machine running the suite happens to have (a runner without a routable
// address would fail a test that never asserted anything about the adapter).
const osMock = vi.hoisted(() => ({ interfaces: null as Record<string, unknown[]> | null }));
vi.mock("node:os", async importOriginal => {
  const actual = await importOriginal<typeof os>();
  const networkInterfaces = (): unknown => osMock.interfaces ?? actual.networkInterfaces();
  return { ...actual, default: { ...actual, networkInterfaces }, networkInterfaces };
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
// The fake PEM blocks above are no material OpenSSL loads — the pair check in
// tls-material (v1.19.0) is proven against real certificates in its own suite.
vi.mock("node:tls", async importOriginal => {
  const actual = await importOriginal<typeof tls>();
  return { ...actual, createSecureContext: vi.fn(() => ({})) };
});

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
  forgetState: ReturnType<typeof vi.fn>;
  resetAutoAddBudget: ReturnType<typeof vi.fn>;
  options: unknown;
}

/**
 * Typed access to the private members the orchestration tests drive.
 *
 * @param adapter The adapter under test (its private members are exposed as-is)
 */
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
  extendObject: ReturnType<typeof vi.fn>;
  getStateAsync: ReturnType<typeof vi.fn>;
  getObjectAsync: ReturnType<typeof vi.fn>;
  getObjectListAsync: ReturnType<typeof vi.fn>;
  getDevicesAsync: ReturnType<typeof vi.fn>;
  getStatesOfAsync: ReturnType<typeof vi.fn>;
  delObjectAsync: ReturnType<typeof vi.fn>;
  setObjectNotExistsAsync: ReturnType<typeof vi.fn>;
  setForeignObject: ReturnType<typeof vi.fn>;
  pairingTimeoutId: unknown;
  _pairingEnabled: boolean;
  _disableAuth: boolean;
  nativePersistPending: boolean;
  onReady: () => Promise<void>;
  onUnload: (cb: () => void) => void;
  getForeignObjectAsync: ReturnType<typeof vi.fn>;
  onStateChange: (id: string, state: ioBroker.State | null | undefined) => void;
  buildConfig: () => Promise<{
    bind: string;
    port: number;
    advertiseHost: string;
    identity: { udn: string; mac: string };
    https?: { cert: string; key: string };
  }>;
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
    bind: "192.168.1.10",
    port: 8080,
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
      forgetState: vi.fn(),
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

describe("HueEmu constructor", () => {
  it("asks js-controller for the system language (useFormatDate) — detected lights are named in it", () => {
    setup();
    expect(adapterOptions.last).toMatchObject({ name: "hueemu", useFormatDate: true });
  });
});

describe("HueEmu buildConfig", () => {
  it("resolves bind/ports and derives the bridge identity from UDN/MAC", async () => {
    const { adapter } = setup();
    const config = await internalOf(adapter).buildConfig();
    expect(config.bind).toBe("192.168.1.10");
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

  it("treats a blank bind as listen-all and announces the routable interface, not loopback", async () => {
    osMock.interfaces = {
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
      eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    };
    try {
      const { adapter } = setup({ bind: "  " });
      const i = internalOf(adapter);
      const config = await i.buildConfig();
      expect(config.bind).toBe("0.0.0.0");
      expect(config.advertiseHost).toBe("192.168.1.20");
      expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Announcing 192.168.1.20 (interface eth0)"));
    } finally {
      osMock.interfaces = null;
    }
  });

  // v1.19.0: the pre-1.12 advertiseHost is migrated into bind (or dropped) before
  // buildConfig runs — a leftover value is no longer read.
  it("ignores a leftover advertiseHost and announces the detected address", async () => {
    osMock.interfaces = { eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }] };
    try {
      const { adapter } = setup({ bind: "0.0.0.0", advertiseHost: "10.1.2.3" });
      const config = await internalOf(adapter).buildConfig();
      expect(config.advertiseHost).toBe("192.168.1.20");
    } finally {
      osMock.interfaces = null;
    }
  });

  it("advertises a concrete bind address", async () => {
    const { adapter } = setup({ bind: "192.168.5.5" });
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
    const i = internalOf(adapter);
    const config = await i.buildConfig();
    expect(config.https).toEqual({ port: 8443, cert: PERSISTED_CERT, key: PERSISTED_KEY });
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  // v1.18.0 (audit 2026-09-15 B4): the identity and the certificate used to be
  // two writes on a first HTTPS start — the second one for a process the first
  // had already committed to restarting.
  it("stores a generated identity AND a generated certificate in one write", async () => {
    const { adapter } = setup({ udn: "", mac: "", httpsPort: 8443, tlsCert: "", tlsKey: "" });
    const i = internalOf(adapter);
    const config = await i.buildConfig();
    expect(i.extendForeignObjectAsync).toHaveBeenCalledTimes(1);
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: {
        udn: config.identity.udn,
        mac: config.identity.mac,
        tlsCert: expect.stringContaining("GENERATED"),
        // v1.19.0 (audit 2026-09-25 K1): stored encrypted — tlsKey is in encryptedNative.
        tlsKey: expect.stringMatching(/^\$\/aes-192-cbc:ENC\(.*GENERATED/s),
      },
    });
    // …while this run serves with the plaintext key.
    expect(config.https?.key).toContain("GENERATED");
    expect(config.https?.key).not.toContain("aes-192-cbc");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("persisted self-signed TLS certificate"));
    expect(i.nativePersistPending).toBe(true);
  });

  it("regenerates an expired certificate and stores only that", async () => {
    forgeControl.notAfter = new Date("2020-01-01T00:00:00Z");
    const { adapter } = setup({ httpsPort: 8443, tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const i = internalOf(adapter);
    const config = await i.buildConfig();
    expect(config.https?.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: {
        tlsCert: expect.stringContaining("GENERATED"),
        tlsKey: expect.stringMatching(/^\$\/aes-192-cbc:ENC\(.*GENERATED/s),
      },
    });
  });

  // N1: the identity write had no fence — an objects-db hiccup on the very first
  // start took the whole start down although the generated values serve fine.
  it("serves with the generated values and does not restart when the write fails", async () => {
    const { adapter } = setup({ udn: "", mac: "" });
    const i = internalOf(adapter);
    i.extendForeignObjectAsync.mockRejectedValueOnce(new Error("db readonly"));
    const config = await i.buildConfig();
    expect(config.identity.udn).toMatch(/^[0-9a-f-]{36}$/i);
    expect(i.nativePersistPending).toBe(false);
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be stored"));
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

  it("keeps booting when the cleanup of earlier-version objects fails (state handling stays wired)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    // A leftover "user" folder makes the cleanup run its migration — and the list query blows up.
    i.getObjectAsync.mockImplementation((id: string) => Promise.resolve(id === "user" ? { type: "meta" } : null));
    i.getObjectListAsync.mockRejectedValue(new Error("objects db timeout"));
    await i.onReady();
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("Cleanup of objects from earlier versions failed"));
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Hue Emulator running"));
    expect(i.log.error).not.toHaveBeenCalled();
  });

  // F10 (audit 2026-09-15): the cleanup's wiring to the adapter — the object read,
  // the delete, the range query for an emptied parent — ran in no test at all.
  it("removes an object from an earlier version and its emptied parent on start", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "info.configuredDevices" ? { type: "state" } : null),
    );
    i.getObjectListAsync.mockImplementation((query: { startkey: string }) =>
      Promise.resolve({ rows: query.startkey.startsWith("hueemu.0.info.") ? [] : [{ id: "x" }] }),
    );
    await i.onReady();
    expect(i.delObjectAsync).toHaveBeenCalledWith("info.configuredDevices");
    expect(i.delObjectAsync).toHaveBeenCalledWith("info");
    expect(i.getObjectListAsync).toHaveBeenCalledWith({ startkey: "hueemu.0.info.", endkey: "hueemu.0.info.\uffff" });
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
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
      start: vi.fn(() => {
        disableAuthAtHttpStart = adapter.disableAuth;
        return Promise.resolve();
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

  it("feeds an unacked foreign write into the handler's state cache too", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    // v1.18.0 (decision 26): a datapoint nobody confirms — 0_userdata, a script,
    // vis — carries ack:false for good. Ignoring such changes left every light
    // bound to one standing still in the bridge, while the adapter's own
    // commands were cached optimistically all along. The device's acked answer
    // still corrects the cache afterwards.
    i.onStateChange("hue.0.light.bri", { val: 80, ack: false } as ioBroker.State);
    expect(handlers[0].onStateChange).toHaveBeenCalledWith("hue.0.light.bri", 80);
    // A foreign unacked change is data, never a command for the adapter's own states.
    expect(adapter.pairingEnabled).toBe(false);
  });

  it("tells the handler to forget a deleted state", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hue.0.light.bri", null);
    expect(handlers[0].forgetState).toHaveBeenCalledWith("hue.0.light.bri");
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

  it("logs (and survives) a failing ack write instead of leaving an unhandled rejection", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.setState.mockRejectedValueOnce(new Error("broker down"));
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);
    await vi.waitFor(() =>
      expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("setState startPairing failed")),
    );
  });

  it("logs a throwing handler instead of propagating (no crash on a bad state event)", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    handlers[0].onStateChange.mockImplementation(() => {
      throw new Error("cache exploded");
    });
    expect(() => i.onStateChange("hue.0.light.bri", { val: 1, ack: true } as ioBroker.State)).not.toThrow();
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("stateChange failed"));
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
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(i.clearTimeout).toHaveBeenCalled();
    // The announce pulse must not outlive the server (sync clear in onUnload).
    expect(i.clearInterval).toHaveBeenCalledWith(i.setInterval.mock.results[0].value);
    expect(ssdps[0].stop).toHaveBeenCalled();
    expect(servers[0].stop).toHaveBeenCalled();
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
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("Error during shutdown"));
  });

  // v1.18.0 (audit 2026-09-15 B3): in compact mode the process outlives an
  // unload. A start that carried on after the stop request bound the listener
  // for nobody — and the restarted instance ran into EADDRINUSE.
  it("stops the start when the unload arrives while the configuration is being built", async () => {
    const { adapter, servers, ssdps } = setup();
    const i = internalOf(adapter);
    const original = i.buildConfig.bind(adapter);
    const callback = vi.fn();
    i.buildConfig = async () => {
      const config = await original();
      i.onUnload(callback);
      return config;
    };
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(servers).toHaveLength(0);
    expect(ssdps).toHaveLength(0);
    expect(i.setState).not.toHaveBeenCalledWith("info.connection", expect.objectContaining({ val: true }));
  });

  it("releases a listener that finished binding after the unload arrived", async () => {
    const { adapter, servers, ssdps } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as { makeHueServer: (o: unknown) => FakeHueServer };
    const origFactory = internal.makeHueServer.bind(adapter);
    const callback = vi.fn();
    internal.makeHueServer = (o: unknown) => {
      const s = origFactory(o);
      s.start.mockImplementation(() => {
        i.onUnload(callback);
        return Promise.resolve();
      });
      return s;
    };
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(servers[0].stop).toHaveBeenCalled();
    expect(ssdps[0].start).not.toHaveBeenCalled();
    expect(i.subscribeStates).not.toHaveBeenCalled();
  });

  it("is safe before onReady (no servers constructed yet)", async () => {
    const { adapter } = setup();
    const callback = vi.fn();
    internalOf(adapter).onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  });

  it("says goodbye on the network BEFORE telling the controller we are done", async () => {
    // The bye-bye datagrams are what tell Alexa & friends the bridge is gone. Reporting
    // "done" first loses them — the host tears the process down as soon as it is told.
    const { adapter, servers, ssdps } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    const order: string[] = [];
    ssdps[0].stop.mockImplementation(
      () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            order.push("byebye");
            resolve();
          }, 0),
        ),
    );
    servers[0].stop.mockImplementation(
      () =>
        new Promise<void>(resolve =>
          setTimeout(() => {
            order.push("http-closed");
            resolve();
          }, 0),
        ),
    );
    const callback = vi.fn(() => order.push("callback"));

    i.onUnload(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

    expect(order).toEqual(["byebye", "http-closed", "callback"]);
  });

  it("the manifest must not declare stopInstance, or none of this runs at all", () => {
    // With the entry the host kills the process one second after asking it to stop — the
    // bye-bye datagrams never leave. `deviceManager` must stay, the device view needs it.
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "io-package.json"), "utf8")) as {
      common: { supportedMessages?: Record<string, unknown> };
    };
    expect(manifest.common.supportedMessages?.stopInstance).toBeUndefined();
    expect(manifest.common.supportedMessages?.deviceManager).toBe(true);
  });

  it("stores the listen address and port under the keys the admin's port-conflict check reads", () => {
    // v1.18.0 — `native.bind` (a string) + `native.port` (a number) is the pair the admin
    // compares across instances; the form field for the address is `bind` of type `ip`,
    // offering 0.0.0.0, and nothing writes the pre-1.18 key `host` any more.
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "io-package.json"), "utf8")) as {
      native: Record<string, unknown>;
    };
    expect(manifest.native.bind).toBe("0.0.0.0");
    expect(manifest.native.port).toBe(8080);
    expect("host" in manifest.native).toBe(false);

    const form = JSON.parse(readFileSync(join(__dirname, "..", "admin", "jsonConfig.json"), "utf8")) as {
      items: { networkTab: { items: Record<string, Record<string, unknown>> } };
    };
    const fields = form.items.networkTab.items;
    expect(fields.bind).toMatchObject({ type: "ip", label: "bind", tooltip: "bindTooltip", listenOnAllPorts: true });
    expect(fields.port).toMatchObject({ type: "port", min: 1, max: 65535 });
    expect(fields.host).toBeUndefined();
  });

  it("switches off a leftover stopInstance flag and stops the start there", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { stopInstance: true, deviceManager: true } },
    });

    await i.onReady();

    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      common: { supportedMessages: { stopInstance: false } },
    });
    expect(servers).toHaveLength(0);
  });

  it("starts normally when the instance object cannot be read (checks again next start)", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockRejectedValue(new Error("objects db unreachable"));
    await i.onReady();
    expect(servers).toHaveLength(1);
    expect(i.log.debug).toHaveBeenCalledWith(expect.stringContaining("Could not check the instance object"));
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith("system.adapter.hueemu.0", expect.anything());
  });

  it("starts normally when the flag is already off", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { stopInstance: false, deviceManager: true } },
    });

    await i.onReady();

    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith("system.adapter.hueemu.0", expect.anything());
    expect(servers).toHaveLength(1);
  });

  // v1.18.0: the listen address moved from `host` to the standard key `bind`, the port
  // became a number. The update leaves both keys behind — `bind` with the manifest
  // default, `host` with the user's address — and the first start moves the value.
  it("carries a legacy host/port into the standard keys and stops the start for the restart", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { deviceManager: true } },
      native: { host: "192.168.1.10", bind: "0.0.0.0", port: "8080" },
    });

    await i.onReady();

    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: { bind: "192.168.1.10", host: null, port: 8080 },
    });
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("restarts once"));
    expect(servers).toHaveLength(0);
  });

  // v1.19.0: a pre-1.12 advertiseHost that still belongs to this host moves into bind
  // when the instance listens everywhere; keys no version reads are dropped.
  it("carries a live legacy advertiseHost into bind and drops the obsolete keys", async () => {
    osMock.interfaces = { eth0: [{ family: "IPv4", address: "10.1.2.3", internal: false }] };
    try {
      const { adapter, servers } = setup({ bind: "0.0.0.0", advertiseHost: "10.1.2.3" });
      const i = internalOf(adapter);
      i.getForeignObjectAsync.mockResolvedValue({
        common: { supportedMessages: { deviceManager: true } },
        native: {
          bind: "0.0.0.0",
          port: 8080,
          advertiseHost: "10.1.2.3",
          discoveryHost: "192.168.178.10",
          discoveryPort: 80,
          upnpPort: 1900,
        },
      });

      await i.onReady();

      expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
        native: { bind: "10.1.2.3", advertiseHost: null, discoveryHost: null, discoveryPort: null, upnpPort: null },
      });
      expect(servers).toHaveLength(0);
    } finally {
      osMock.interfaces = null;
    }
  });

  it("starts normally on an installation that already uses bind and a numeric port", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockResolvedValue({
      common: { supportedMessages: { deviceManager: true } },
      native: { bind: "0.0.0.0", port: 8080, host: null },
    });

    await i.onReady();

    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith("system.adapter.hueemu.0", expect.anything());
    expect(servers).toHaveLength(1);
  });
});

describe("HueEmu migrateUserToClients (v1.2.0 rename)", () => {
  it("moves user.* states to clients.* (sanitized) and removes the old folder", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) => Promise.resolve(id === "user" ? { type: "meta" } : null));
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
    expect(i.setState).toHaveBeenCalledWith("clients.alexa_echo", { val: "alexa.echo", ack: true });
    expect(i.delObjectAsync).toHaveBeenCalledWith("user.alexa.echo");
    expect(i.delObjectAsync).toHaveBeenCalledWith("user");
  });

  it("is a no-op when no user folder exists", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.migrateUserToClients();
    expect(i.delObjectAsync).not.toHaveBeenCalled();
  });

  it("lifts the migrated client to the current name/description standard right away", async () => {
    // This migration runs LATE in onReady, the client refresh runs early — so a
    // migrated object would otherwise carry its bare legacy name until the NEXT
    // start. One restart of nothing but wrong text in the tree.
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) => Promise.resolve(id === "user" ? { type: "meta" } : null));
    i.getObjectListAsync.mockResolvedValue({
      rows: [
        {
          id: "hueemu.0.user.old.echo",
          value: { common: { name: "Echo", type: "string", role: "text", read: true, write: false }, native: {} },
        },
      ],
    });
    i.getStateAsync.mockResolvedValue({ val: "old.echo", ack: true });

    await i.migrateUserToClients();

    const [, obj] = i.setObjectNotExistsAsync.mock.calls.find(c => c[0] === "clients.old_echo") as [
      string,
      ioBroker.SettableObject,
    ];
    expect((obj.common?.name as Record<string, string>).de).toBe("Echo");
    expect(Object.keys(obj.common?.name as object)).toHaveLength(11);
    expect(obj.common?.desc).toEqual({ en: "clientDesc" });
    // The rest of the legacy common survives.
    expect(obj.common).toMatchObject({ type: "string", role: "text", read: true, write: false });
  });

  it("keeps a legacy name that is already a translation object", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) => Promise.resolve(id === "user" ? { type: "meta" } : null));
    i.getObjectListAsync.mockResolvedValue({
      rows: [
        {
          id: "hueemu.0.user.done",
          value: { common: { name: { en: "Echo", de: "Echo" }, type: "string", role: "text" }, native: {} },
        },
      ],
    });
    i.getStateAsync.mockResolvedValue({ val: "done", ack: true });

    await i.migrateUserToClients();

    const [, obj] = i.setObjectNotExistsAsync.mock.calls.find(c => c[0] === "clients.done") as [
      string,
      ioBroker.SettableObject,
    ];
    expect(obj.common?.name).toEqual({ en: "Echo", de: "Echo" });
  });

  it("creates the clients folder WITH its description on this path too", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) => Promise.resolve(id === "user" ? { type: "meta" } : null));
    // The folder is only created when there is something to migrate.
    i.getObjectListAsync.mockResolvedValue({
      rows: [{ id: "hueemu.0.user.x", value: { common: { name: "X", type: "string", role: "text" }, native: {} } }],
    });
    i.getStateAsync.mockResolvedValue({ val: "x", ack: true });

    await i.migrateUserToClients();

    const [, folder] = i.setObjectNotExistsAsync.mock.calls.find(c => c[0] === "clients") as [
      string,
      ioBroker.SettableObject,
    ];
    expect(folder.common?.desc).toEqual({ en: "clientsFolderDesc" });
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

    const deleted = i.delObjectAsync.mock.calls.map(c => c[0]);
    // Obsolete metadata wrappers are removed...
    expect(deleted).toContain("legacylamp.name");
    expect(deleted).toContain("legacylamp.data");
    // ...but the parents of the retained leaf states must NOT be orphaned.
    expect(deleted).not.toContain("legacylamp.state");
    expect(deleted).not.toContain("legacylamp");
  });
});

describe("HueEmu device numbering (v1.18.0)", () => {
  // A light's Hue id and uniqueid were its position in native.devices — deleting
  // one light re-identified every light behind it for Alexa (audit 2026-09-15 A4).
  // The first start numbers the stored lights once; a native write restarts the
  // instance, so the start stops exactly like the other migrations.
  it("numbers the stored lights by position, writes once and stops the start", async () => {
    const { adapter, servers, ssdps } = setup({
      devices: [
        { name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { name: "Hall", lightType: "dimmable", briState: "h.bri" },
      ],
    });
    const i = internalOf(adapter);

    await i.onReady();

    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: {
        devices: [
          { id: 1, name: "Kitchen", lightType: "onoff", onState: "k.on" },
          { id: 2, name: "Hall", lightType: "dimmable", briState: "h.bri" },
        ],
      },
    });
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("permanent light numbers"));
    expect(servers).toHaveLength(0);
    expect(ssdps).toHaveLength(0);
    expect(i.subscribeStates).not.toHaveBeenCalled();
  });

  it("boots with the numbers in memory when the write fails, and retries next start", async () => {
    const { adapter, servers, handlers } = setup({
      devices: [{ name: "Kitchen", lightType: "onoff", onState: "k.on" }],
    });
    const i = internalOf(adapter);
    i.extendForeignObjectAsync.mockRejectedValueOnce(new Error("objects db down"));

    await i.onReady();

    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("Light numbers could not be stored"));
    expect(servers).toHaveLength(1);
    // The running adapter works with the numbers the write would have stored.
    expect((handlers[0].options as { devices: { id?: number }[] }).devices[0].id).toBe(1);
  });

  it("boots straight through when every light is numbered already", async () => {
    const { adapter, servers } = setup({
      devices: [{ id: 7, name: "Bulb", lightType: "ct", onState: "z.on", ctState: "z.ct" }],
    });
    const i = internalOf(adapter);

    await i.onReady();

    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith(
      "system.adapter.hueemu.0",
      expect.objectContaining({ native: expect.objectContaining({ devices: expect.anything() }) }),
    );
    expect(servers).toHaveLength(1);
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
  });

  it("boots normally for an installation without configured lights", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(servers).toHaveLength(1);
  });
});

describe("HueEmu refreshInstanceObjects (v1.15.0)", () => {
  it("re-applies all three manifest objects on every start", async () => {
    // js-controller creates instanceObjects only where they are MISSING, so a
    // changed name or description would otherwise reach fresh installs only —
    // the manifest looks right while every existing tree keeps the old text.
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();

    const ids = i.extendObject.mock.calls.map(c => c[0] as string);
    expect(ids).toEqual(expect.arrayContaining(["startPairing", "disableAuth", "clients"]));
  });

  it("carries name AND description, as translation objects", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();

    const byId = new Map(i.extendObject.mock.calls.map(c => [c[0] as string, c[1] as ioBroker.SettableObject]));
    const pairing = byId.get("startPairing");
    expect(pairing?.common?.name).toEqual({ en: "startPairingName" });
    expect(pairing?.common?.desc).toEqual({ en: "startPairingDesc" });
    const auth = byId.get("disableAuth");
    expect(auth?.common?.name).toEqual({ en: "disableAuthName" });
    expect(auth?.common?.desc).toEqual({ en: "disableAuthDesc" });
    expect(byId.get("clients")?.common?.name).toEqual({ en: "clientsFolder" });
  });

  it("refreshes BEFORE the servers bind — a start that dies later still fixed the tree", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(i.extendObject.mock.invocationCallOrder[0]).toBeLessThan(servers[0].start.mock.invocationCallOrder[0]);
  });

  // v1.19.0: the SHAPE (type, role, read/write, def) lives in the manifest alone —
  // js-controller applies instanceObjects on every start and keeps only the name.
  // A copy here could drift from the manifest; the refresh carries texts only.
  it("carries only name and description — the shape stays in the manifest", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    const byId = new Map(i.extendObject.mock.calls.map(c => [c[0] as string, c[1] as ioBroker.SettableObject]));
    for (const id of ["startPairing", "disableAuth", "info", "info.connection", "info.error"]) {
      const patch = byId.get(id);
      expect(patch, id).toBeDefined();
      expect(Object.keys(patch ?? {}), id).toEqual(["common"]);
      expect(
        Object.keys(patch?.common ?? {}).every(k => k === "name" || k === "desc"),
        id,
      ).toBe(true);
    }
    // v1.17.0: the clients container is a `folder` — that type is part of the
    // meta→folder migration, not of a shape copy. The old `meta.folder` is NOT
    // removed via a null in this patch (js-controller warns on it every start);
    // the cleanup runs as a separate read + setForeignObject (own tests above).
    expect(byId.get("clients")?.type).toBe("folder");
    expect(byId.get("clients")?.common).not.toHaveProperty("type");
    // Every object carries an explanation, the folder included.
    expect(byId.get("clients")?.common?.desc).toEqual({ en: "clientsFolderDesc" });
    expect(byId.get("info.connection")?.common?.desc).toEqual({ en: "infoConnectionDesc" });
  });
});

describe("HueEmu refreshClientNames (v1.15.1)", () => {
  /**
   * A stored client object with the given name shape.
   *
   * @param id The client id under `clients.`
   * @param name The stored `common.name` — a bare string before v1.15.1
   */
  function client(id: string, name: unknown): unknown {
    return { _id: `hueemu.0.clients.${id}`, type: "state", common: { name, type: "string", role: "text" }, native: {} };
  }

  it("converts a bare-string client name into a translation object", async () => {
    // Client objects are created once with setObjectNotExists and never touched
    // again — the bare string versions before 1.15.1 wrote stayed in the tree for
    // the life of the pairing (measured live 2026-09-03).
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStatesOfAsync.mockResolvedValue([client("abc", "Harmony Hub")]);

    await i.onReady();

    const call = i.extendObject.mock.calls.find(c => c[0] === "clients.abc");
    expect(call).toBeDefined();
    const name = (call![1] as ioBroker.SettableObject).common?.name as Record<string, string>;
    expect(name.en).toBe("Harmony Hub");
    expect(name.de).toBe("Harmony Hub");
    expect(Object.keys(name)).toHaveLength(11);
  });

  it("leaves a client alone once name AND description are in place", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const done = client("done", { en: "Echo", de: "Echo" }) as { common: Record<string, unknown> };
    done.common.desc = { en: "key" };
    i.getStatesOfAsync.mockResolvedValue([done]);

    await i.onReady();

    expect(i.extendObject.mock.calls.find(c => c[0] === "clients.done")).toBeUndefined();
  });

  it("adds the missing description even when the name is already converted", async () => {
    // Every datapoint carries a name AND an explanation — a client converted by an
    // earlier step must still pick up the description.
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStatesOfAsync.mockResolvedValue([client("half", { en: "Echo", de: "Echo" })]);

    await i.onReady();

    const call = i.extendObject.mock.calls.find(c => c[0] === "clients.half");
    expect((call![1] as ioBroker.SettableObject).common?.desc).toEqual({ en: "clientDesc" });
    expect((call![1] as ioBroker.SettableObject).common?.name).toBeUndefined();
  });

  it("gives a converted client both a translated name and a description", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStatesOfAsync.mockResolvedValue([client("both", "Harmony Hub")]);

    await i.onReady();

    const common = (i.extendObject.mock.calls.find(c => c[0] === "clients.both")![1] as ioBroker.SettableObject)
      .common as Record<string, unknown>;
    expect((common.name as Record<string, string>).de).toBe("Harmony Hub");
    expect(common.desc).toEqual({ en: "clientDesc" });
  });

  it("keeps the client's own text — it is the device type, not a label", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getStatesOfAsync.mockResolvedValue([client("x", "auto-paired")]);

    await i.onReady();

    const call = i.extendObject.mock.calls.find(c => c[0] === "clients.x");
    expect((call![1] as ioBroker.SettableObject).common?.name).toMatchObject({ en: "auto-paired" });
  });

  it("keeps booting when the clients folder cannot be read", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getStatesOfAsync.mockRejectedValue(new Error("objects db down"));

    await i.onReady();

    expect(servers).toHaveLength(1);
    expect(i.subscribeStates).toHaveBeenCalledWith("*");
  });
});

describe("HueEmu info.connection / info.error (v1.17.0)", () => {
  // Before this, a start that failed left one line in the log while the instance
  // stayed green in the admin and the object tree said nothing (audit
  // 2026-09-06 F4). `Unknown` while there is nothing to report yet, empty while
  // it works, the real cause otherwise — never "the adapter is stopped".
  it("reports Unknown before the listener is up and clears it on success", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(i.setState).toHaveBeenCalledWith("info.connection", { ack: true, val: false });
    expect(i.setState).toHaveBeenCalledWith("info.error", { ack: true, val: "Unknown" });
    expect(i.setState).toHaveBeenCalledWith("info.connection", { ack: true, val: true });
    expect(i.setState).toHaveBeenCalledWith("info.error", { ack: true, val: "" });
  });

  /**
   * Every value written to the reason datapoint, in order. Asserting the whole
   * sequence matters: `Unknown` is also the start stamp, so a plain
   * `toHaveBeenCalledWith` would pass even if the catch branch wrote nothing.
   *
   * @param i The adapter internals from {@link internalOf}.
   */
  const reasonWrites = (i: ReturnType<typeof internalOf>): unknown[] =>
    i.setState.mock.calls
      .filter((c: unknown[]) => c[0] === "info.error")
      .map((c: unknown[]) => (c[1] as { val: unknown }).val);

  it("keeps the adapter's OWN wording out of the datapoint and logs it instead", async () => {
    // Fleet rule (krobi 2026-08-27): the reason text is never an adapter-specific
    // phrasing and never an appended explanation. "Port not specified" is both
    // hueemu's own invention and useless in a datapoint — it belongs in the log.
    const { adapter } = setup({ port: undefined });
    const i = internalOf(adapter);
    await i.onReady();
    expect(reasonWrites(i)).toEqual(["Unknown", "Unknown"]);
    expect(i.setState).not.toHaveBeenCalledWith("info.connection", { ack: true, val: true });
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("Port not specified"));
  });

  it("passes a FOREIGN cause through — that text is nobody's invention", async () => {
    // The real EADDRINUSE path: node throws out of `listen`, hue-server does not
    // catch it for the HTTP server, and onReady's catch is where it arrives.
    const { adapter } = setup();
    const i = internalOf(adapter);
    const busy = "listen EADDRINUSE: address already in use 0.0.0.0:8080";
    (adapter as unknown as { makeHueServer: (o: unknown) => FakeHueServer }).makeHueServer = options => ({
      start: vi.fn(() => Promise.reject(new Error(busy))),
      stop: vi.fn(() => Promise.resolve()),
      options,
    });
    await i.onReady();
    expect(reasonWrites(i)).toEqual(["Unknown", busy]);
    expect(i.setState).not.toHaveBeenCalledWith("info.connection", { ack: true, val: true });
  });

  it("strips the stale meta common.type WITHOUT the null patch js-controller rejects", async () => {
    // `extendObject(… common: { type: null })` does delete the field, but
    // js-controller validates the PATCH first and logs "obj.common.type has an
    // invalid type … will throw an error up from js-controller version 7.0.0"
    // on every start of every installation (measured 2026-09-06). Read + rewrite
    // touches the object only when there is really something to remove.
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(
        id === "clients"
          ? { _id: "hueemu.0.clients", type: "folder", common: { name: { en: "Clients" }, type: "meta.folder" } }
          : null,
      ),
    );
    await i.onReady();
    // The copy goes back under the FULL id — setForeignObject does not prefix the namespace.
    const written = i.setForeignObject.mock.calls.find((c: unknown[]) => c[0] === "hueemu.0.clients");
    expect(written).toBeDefined();
    expect((written?.[1] as { common: Record<string, unknown> }).common).not.toHaveProperty("type");
    const patches = i.extendObject.mock.calls.filter((c: unknown[]) => c[0] === "clients");
    expect(patches.every((c: unknown[]) => !("type" in (c[1] as { common: object }).common))).toBe(true);
  });

  it("leaves the clients folder alone when it never was a meta object", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "clients" ? { _id: "hueemu.0.clients", type: "folder", common: { name: {} } } : null),
    );
    await i.onReady();
    expect(i.setForeignObject.mock.calls.filter((c: unknown[]) => c[0] === "hueemu.0.clients")).toEqual([]);
  });

  it("creates both objects on every start so an update reaches an existing tree", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    const ids = i.extendObject.mock.calls.map((c: unknown[]) => c[0]);
    expect(ids).toContain("info");
    expect(ids).toContain("info.connection");
    expect(ids).toContain("info.error");
  });

  it("says the bridge is gone before reporting the shutdown as done", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    const order: string[] = [];
    i.setState.mockImplementation((id: string) => {
      order.push(id);
      return Promise.resolve();
    });
    await new Promise<void>(resolve => i.onUnload(() => resolve()));
    expect(order).toEqual(["info.connection", "info.error"]);
  });
});
