/**
 * Orchestration tests for main.ts (HueEmu) — previously untested at 0 %.
 * Drives onReady/onStateChange/onUnload, buildConfig, the TLS lifecycle and
 * the legacy migrations through the makeHueServer/makeSsdpServer/
 * makeApiHandler seams, without binding real ports or generating real keys.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import type * as tls from "node:tls";
import { join } from "node:path";
import { vi } from "vitest";

/** The options the adapter hands to adapter-core — recorded by the stub. */
const adapterOptions = vi.hoisted((): { last: unknown } => ({ last: undefined }));
/** The instance data folder the stub hands out — a fresh temporary folder per test (audit R-24). */
const dataDir = vi.hoisted((): { current: string } => ({ current: "" }));

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
    public getStatesAsync = vi.fn(() => Promise.resolve({}));
    public delForeignObjectAsync = vi.fn(async () => {});
    public extendForeignObjectAsync = vi.fn(async () => {});
    public getForeignObjectAsync = vi.fn((): Promise<unknown> => Promise.resolve(null));
    public getForeignObjectsAsync = vi.fn((): Promise<unknown> => Promise.resolve({}));
    public extendObjectAsync = vi.fn(async () => {});
    public extendObject = vi.fn(async () => {});
    public subscribeStates = vi.fn();
    public subscribeObjects = vi.fn();
    public setTimeout = vi.fn(() => ({}));
    public clearTimeout = vi.fn();
    public setInterval = vi.fn(() => ({}));
    public clearInterval = vi.fn();
    public terminate = vi.fn();
    public sendTo = vi.fn();
    // js-controller's own form is `$/aes-192-cbc:<iv>:<ciphertext>` — the prefix is what
    // its start-up decryption keys on; anything without it is decrypted as garbage.
    public encrypt = vi.fn((v: string) => `$/aes-192-cbc:ENC(${v})`);
    public decrypt = vi.fn((v: string) => v.replace(/^\$\/aes-192-cbc:ENC\(([\s\S]*)\)$/, "$1"));
    constructor(opts: unknown) {
      adapterOptions.last = opts;
    }
  }
  return {
    Adapter,
    EXIT_CODES: { UNCAUGHT_EXCEPTION: 6, ADAPTER_REQUESTED_TERMINATION: 11 },
    getAbsoluteInstanceDataDir: () => dataDir.current,
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

import { I18n } from "@iobroker/adapter-core";
import * as mainModule from "./main";
import { readDataFile } from "./lib/data-file";
import { mergedWith } from "./lib/known-objects";
import { ConfigurationError } from "./types/errors";
import { storedClientKeys } from "../test/test-helpers";

/** The cipher of the fake adapter above, for reading back what it encrypted. */
const MAIN_CIPHER = {
  encrypt: (v: string): string => `$/aes-192-cbc:ENC(${v})`,
  decrypt: (v: string): string => v.replace(/^\$\/aes-192-cbc:ENC\(([\s\S]*)\)$/, "$1"),
};

// main.ts exports the factory with the class riding along (no `export class`, so esbuild builds it as CommonJS).
/** The public face of the adapter the tests read: the base adapter plus its two getters. */
type HueEmu = ioBroker.Adapter & { readonly pairingEnabled: boolean; readonly disableAuth: boolean };
const { HueEmu } = mainModule as unknown as { HueEmu: new () => HueEmu };

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
  replaceDevices: ReturnType<typeof vi.fn>;
  onStateChange: ReturnType<typeof vi.fn>;
  forgetClient: ReturnType<typeof vi.fn>;
  forgetState: ReturnType<typeof vi.fn>;
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
  terminate: ReturnType<typeof vi.fn>;
  subscribeStates: ReturnType<typeof vi.fn>;
  subscribeObjects: ReturnType<typeof vi.fn>;
  onObjectChange: (id: string, obj: ioBroker.Object | null | undefined) => void;
  onMessage: (obj: ioBroker.Message) => void;
  sendTo: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
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
  identity: { udn: string; tlsCert?: string; privateKey?: string };
  loadIdentity: () => void;
  decrypt: ReturnType<typeof vi.fn>;
  onReady: () => Promise<void>;
  onUnload: (cb: () => void) => void;
  getForeignObjectAsync: ReturnType<typeof vi.fn>;
  getForeignObjectsAsync: ReturnType<typeof vi.fn>;
  onStateChange: (id: string, state: ioBroker.State | null | undefined) => void;
  buildConfig: () => {
    bind: string;
    port: number;
    advertiseHost: string;
    identity: { udn: string; mac: string };
    https?: { cert: string; key: string };
  };
  delForeignObjectAsync: ReturnType<typeof vi.fn>;
  prepareClients: () => Promise<{ keyOf: (id: string) => string | undefined }>;
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
      replaceDevices: vi.fn(async () => {}),
      onStateChange: vi.fn(),
      forgetState: vi.fn(),
      forgetClient: vi.fn(),
      options,
    };
    handlers.push(h);
    return h;
  };
  return { adapter, servers, ssdps, handlers };
}

// The host the suite pretends to be: it carries the address setup() chooses (192.168.1.10/24),
// so a chosen address is honoured instead of falling back to every address (network-address.ts).
const HOST_INTERFACES = {
  lo: [{ family: "IPv4", address: "127.0.0.1", internal: true, cidr: "127.0.0.1/8" }],
  eth0: [{ family: "IPv4", address: "192.168.1.10", internal: false, cidr: "192.168.1.10/24" }],
};

beforeEach(() => {
  forgeControl.notAfter = new Date("2090-01-01T00:00:00Z");
  forgeControl.parseThrows = false;
  osMock.interfaces = structuredClone(HOST_INTERFACES);
  dataDir.current = mkdtempSync(join(os.tmpdir(), "hueemu-data-"));
});

afterEach(() => {
  rmSync(dataDir.current, { recursive: true, force: true });
});

/** What the identity file in this test's data folder holds (audit R-24), read back through the fleet master. */
function storedIdentity(): Record<string, unknown> {
  const read = readDataFile(dataDir.current, "identity.json", { cipher: MAIN_CIPHER, fields: ["privateKey"] });
  return read.value as Record<string, unknown>;
}

/** The identity file as it lies on the disk — the private key sealed by the fleet master (S7, round 174). */
function rawIdentity(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dataDir.current, "identity.json"), "utf8")) as Record<string, unknown>;
}

/**
 * The private key as the fleet master stores it with the fake adapter's cipher.
 *
 * @param key the key in clear text
 */
const sealedKey = (key: string): { $encrypted: string } => ({ $encrypted: MAIN_CIPHER.encrypt(JSON.stringify(key)) });

/**
 * Load the identity, then build the configuration — the order onReady runs them in.
 *
 * @param adapter the adapter under test
 */
function configOf(adapter: HueEmu): ReturnType<ReturnType<typeof internalOf>["buildConfig"]> {
  const i = internalOf(adapter);
  i.loadIdentity();
  return i.buildConfig();
}

/**
 * An in-memory object database behind the stub's object calls — what the light store reads and writes (audit R-24).
 * `system.adapter.hueemu.0` answers with the given native; a write to it is only recorded (the spy keeps the call).
 *
 * @param adapter the adapter under test
 * @param seed the objects there before the start (full id → object)
 * @param native what the instance object's native holds
 * @returns the database
 */
function objectDb(
  adapter: HueEmu,
  seed: Record<string, unknown> = {},
  native: Record<string, unknown> | undefined = undefined,
): Map<string, Record<string, unknown>> {
  const i = internalOf(adapter);
  const db = new Map(Object.entries(structuredClone(seed)) as Array<[string, Record<string, unknown>]>);
  const own = "system.adapter.hueemu.0";
  i.getObjectListAsync.mockImplementation((q: { startkey: string; endkey: string }) =>
    Promise.resolve({
      rows: [...db]
        .filter(([id]) => id >= q.startkey && id <= q.endkey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => ({ id, value: structuredClone(value) })),
    }),
  );
  i.setForeignObject.mockImplementation((id: string, obj: Record<string, unknown>) => {
    db.set(id, structuredClone(obj));
    return Promise.resolve({ id });
  });
  i.extendForeignObjectAsync.mockImplementation((id: string, patch: unknown) => {
    if (id !== own) {
      db.set(id, mergedWith(db.get(id), patch) as Record<string, unknown>);
    }
    return Promise.resolve();
  });
  i.getForeignObjectAsync.mockImplementation((id: string) =>
    Promise.resolve(
      id === own ? (native ? structuredClone({ native, common: {} }) : null) : structuredClone(db.get(id) ?? null),
    ),
  );
  i.delForeignObjectAsync.mockImplementation((id: string, opts?: { recursive?: boolean }) => {
    for (const key of [...db.keys()]) {
      if (key === id || (opts?.recursive && key.startsWith(`${id}.`))) {
        db.delete(key);
      }
    }
    return Promise.resolve();
  });
  return db;
}

/**
 * A light's device object as an earlier start left it — name and settings, nothing else.
 *
 * @param name its name
 * @param native its settings
 */
function lightDevice(name: string, native: Record<string, unknown>): Record<string, unknown> {
  return { type: "device", common: { name: { en: name } }, native };
}

/** What the number mark file in this test's data folder holds (audit R-24). */
function storedMark(): unknown {
  try {
    return (JSON.parse(readFileSync(join(dataDir.current, "light-ids.json"), "utf8")) as { lastLightId?: unknown })
      .lastLightId;
  } catch {
    return undefined;
  }
}

const PERSISTED_CERT = "-----BEGIN CERTIFICATE-----\nPERSISTED\n-----END CERTIFICATE-----";
const PERSISTED_KEY = "-----BEGIN RSA PRIVATE KEY-----\nPERSISTED\n-----END RSA PRIVATE KEY-----";

describe("HueEmu constructor", () => {
  it("asks js-controller for the system language (useFormatDate) — detected lights are named in it", () => {
    setup();
    expect(adapterOptions.last).toMatchObject({ name: "hueemu", useFormatDate: true });
  });

  // dm-utils listens for messages from the DeviceManagement constructor on, and its
  // handlers translate — built before I18n.init, an early admin message throws.
  it("builds the device manager only in onReady, after I18n.init has run", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter) as unknown as { deviceManagement: unknown; onReady: () => Promise<void> };
    expect(i.deviceManagement).toBeUndefined();
    let builtBeforeInit: boolean | undefined;
    vi.mocked(I18n.init).mockImplementationOnce(() => {
      builtBeforeInit = i.deviceManagement !== undefined;
      return Promise.resolve();
    });
    await i.onReady();
    expect(builtBeforeInit).toBe(false);
    expect(i.deviceManagement).toBeDefined();
  });
});

describe("HueEmu network address (fleet master network-address.ts)", () => {
  // krobi 2026-10-03: an address the host does not carry cannot be served — then every
  // address, and the log says once what to fix.
  it("listens on every address with exactly one warning when the chosen address is not on this host", async () => {
    const { adapter, servers } = setup({ bind: "192.168.1.99" });
    const i = internalOf(adapter);
    await i.onReady();
    const options = servers[0].options as { config: { bind: string; advertiseHost: string } };
    expect(options.config.bind).toBe("0.0.0.0");
    expect(options.config.advertiseHost).toBe("192.168.1.10");
    const warnings = i.log.warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("192.168.1.99"));
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toContain("does not exist on this host");
  });

  it("hands both servers a trust boundary that answers only the chosen network", async () => {
    const { adapter, servers, ssdps } = setup();
    await internalOf(adapter).onReady();
    type Network = { isClientAllowed: (a: string | undefined) => boolean; bindIp?: string };
    const http = servers[0].options as Network;
    const ssdp = ssdps[0].options as Network;
    expect(ssdp.bindIp).toBe("192.168.1.10");
    for (const allowed of [http.isClientAllowed, ssdp.isClientAllowed]) {
      expect(allowed("192.168.1.20")).toBe(true);
      expect(allowed("10.0.0.7")).toBe(false);
      expect(allowed("127.0.0.1")).toBe(false);
    }
  });

  it("answers every network of the host when every address is chosen", async () => {
    osMock.interfaces = {
      ...structuredClone(HOST_INTERFACES),
      eth1: [{ family: "IPv4", address: "10.0.0.5", internal: false, cidr: "10.0.0.5/24" }],
    };
    const { adapter, servers, ssdps } = setup({ bind: "0.0.0.0" });
    await internalOf(adapter).onReady();
    type Network = { isClientAllowed: (a: string | undefined) => boolean; bindIp?: string };
    expect((ssdps[0].options as Network).bindIp).toBeUndefined();
    const allowed = (servers[0].options as Network).isClientAllowed;
    expect(allowed("192.168.1.20")).toBe(true);
    expect(allowed("10.0.0.7")).toBe(true);
    expect(allowed("172.16.0.1")).toBe(false);
  });
});

describe("HueEmu buildConfig", () => {
  it("resolves bind/ports and derives the bridge identity from UDN/MAC", () => {
    const { adapter } = setup();
    const config = configOf(adapter);
    expect(config.bind).toBe("192.168.1.10");
    expect(config.port).toBe(8080);
    expect(config.identity.udn).toBe("12345678-1234-1234-1234-123456789abc");
    expect(config.identity.mac).toBe("AA:BB:CC:DD:EE:FF");
  });

  // Audit R-24: the identity lives in the instance data folder — native is never written for it,
  // and an empty MAC is derived from the UDN on every start.
  it("creates and stores a UDN in the data folder when there is none, and writes nothing to native", () => {
    const { adapter } = setup({ udn: "", mac: "" });
    const i = internalOf(adapter);
    i.loadIdentity();
    const config = i.buildConfig();
    expect(config.identity.udn).toMatch(/^[0-9a-f-]{36}$/i);
    expect(config.identity.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    expect(storedIdentity()).toEqual({ udn: config.identity.udn });
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("keeps the derived MAC the same across starts — it follows the stored UDN", () => {
    const first = configOf(setup({ udn: "", mac: "" }).adapter);
    const second = configOf(setup({ udn: "", mac: "" }).adapter);
    expect(second.identity.udn).toBe(first.identity.udn);
    expect(second.identity.mac).toBe(first.identity.mac);
  });

  it("takes the stored identity over a UDN left in native", () => {
    writeFileSync(
      join(dataDir.current, "identity.json"),
      JSON.stringify({ udn: "aaaaaaaa-0000-0000-0000-000000000001" }),
    );
    const { adapter } = setup();
    expect(configOf(adapter).identity.udn).toBe("aaaaaaaa-0000-0000-0000-000000000001");
  });

  // Audit R-05: a hand-edited instance object can carry a number or null in
  // native.udn / native.mac — `.trim()` on it threw and the adapter never started.
  it("treats a non-text UDN/MAC as missing and creates a fresh identity", () => {
    const { adapter } = setup({ udn: 12345 as unknown as string, mac: null as unknown as string });
    const config = configOf(adapter);
    expect(config.identity.udn).toMatch(/^[0-9a-f-]{36}$/i);
    expect(config.identity.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);
    expect(storedIdentity()).toEqual({ udn: config.identity.udn });
  });

  // S9 (CLAUDE_PATTERNS.md, Geheimnisse, round 174): the UDN is an id the adapter must keep — a file it cannot read
  // fails the start; the bridge never serves under the UDN native still holds or a new one, and the file stays.
  it("fails the start on an unusable identity file and keeps the file", () => {
    for (const content of ["{ not json", JSON.stringify({ udn: "x", tlsCert: "C", privateKey: { $encrypted: "?" } })]) {
      writeFileSync(join(dataDir.current, "identity.json"), content);
      const { adapter } = setup();
      expect(() => internalOf(adapter).loadIdentity()).toThrow(ConfigurationError);
      expect(() => internalOf(adapter).loadIdentity()).toThrow(/identity\.json cannot be used/);
      expect(readFileSync(join(dataDir.current, "identity.json"), "utf8")).toBe(content);
    }
  });

  it("fails the start when a new identity cannot be stored", () => {
    // A folder where the master writes its temporary file — the file is readable (there is none), the write fails.
    mkdirSync(join(dataDir.current, "identity.json.tmp"));
    const { adapter } = setup({ udn: "", mac: "" });
    expect(() => internalOf(adapter).loadIdentity()).toThrow(/could not be stored/);
  });

  it("treats a blank bind as listen-all and announces the routable interface, not loopback", () => {
    osMock.interfaces = {
      lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
      eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    };
    try {
      const { adapter } = setup({ bind: "  " });
      const i = internalOf(adapter);
      const config = configOf(adapter);
      expect(config.bind).toBe("0.0.0.0");
      expect(config.advertiseHost).toBe("192.168.1.20");
      expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Announcing 192.168.1.20 (interface eth0)"));
    } finally {
      osMock.interfaces = null;
    }
  });

  // v1.19.0: the pre-1.12 advertiseHost is migrated into bind (or dropped) before
  // buildConfig runs — a leftover value is no longer read.
  it("ignores a leftover advertiseHost and announces the detected address", () => {
    osMock.interfaces = { eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }] };
    try {
      const { adapter } = setup({ bind: "0.0.0.0", advertiseHost: "10.1.2.3" });
      const config = configOf(adapter);
      expect(config.advertiseHost).toBe("192.168.1.20");
    } finally {
      osMock.interfaces = null;
    }
  });

  it("advertises a concrete bind address the host carries", () => {
    osMock.interfaces = {
      ...structuredClone(HOST_INTERFACES),
      eth1: [{ family: "IPv4", address: "192.168.5.5", internal: false, cidr: "192.168.5.5/24" }],
    };
    const { adapter } = setup({ bind: "192.168.5.5" });
    const config = configOf(adapter);
    expect(config.bind).toBe("192.168.5.5");
    expect(config.advertiseHost).toBe("192.168.5.5");
  });

  it("throws when the HTTPS port equals the HTTP port", () => {
    const { adapter } = setup({ httpsPort: 8080 });
    expect(() => configOf(adapter)).toThrow(/equals HTTP port/);
  });

  it("throws when the port is missing entirely", () => {
    const { adapter } = setup({ port: undefined });
    expect(() => configOf(adapter)).toThrow(/Port not specified/);
  });

  // Audit R-24: a v1.19.0 installation stored the key encrypted in native; after the update
  // js-controller no longer decrypts it (encryptedNative follows the manifest), so it arrives
  // encrypted — decrypted once, the fleet master seals it again in the file (S7).
  it("takes over the certificate and the still encrypted key of v1.19.0 and serves with them", () => {
    const { adapter } = setup({
      httpsPort: 8443,
      tlsCert: PERSISTED_CERT,
      tlsKey: `$/aes-192-cbc:ENC(${PERSISTED_KEY})`,
    });
    const i = internalOf(adapter);
    const config = configOf(adapter);
    expect(config.https).toEqual({ port: 8443, cert: PERSISTED_CERT, key: PERSISTED_KEY });
    expect(storedIdentity()).toEqual({
      udn: "12345678-1234-1234-1234-123456789abc",
      tlsCert: PERSISTED_CERT,
      privateKey: PERSISTED_KEY,
    });
    expect(rawIdentity().privateKey).toEqual(sealedKey(PERSISTED_KEY));
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("takes over a plain-text key of v1.18.0 and earlier and stores it encrypted", () => {
    const { adapter } = setup({ httpsPort: 8443, tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    expect(configOf(adapter).https?.key).toBe(PERSISTED_KEY);
    expect(rawIdentity().privateKey).toEqual(sealedKey(PERSISTED_KEY));
  });

  it("stores a generated certificate in the data folder with the key encrypted, and nothing in native", () => {
    const { adapter } = setup({ udn: "", mac: "", httpsPort: 8443 });
    const i = internalOf(adapter);
    const config = configOf(adapter);
    expect(storedIdentity()).toEqual({
      udn: config.identity.udn,
      tlsCert: expect.stringContaining("GENERATED"),
      privateKey: config.https?.key,
    });
    expect(rawIdentity().privateKey).toEqual(sealedKey(config.https?.key ?? ""));
    // …while this run serves with the plaintext key.
    expect(config.https?.key).toContain("GENERATED");
    expect(config.https?.key).not.toContain("aes-192-cbc");
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("stored self-signed TLS certificate"));
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("reuses the stored certificate on the next start", () => {
    configOf(setup({ udn: "", mac: "", httpsPort: 8443 }).adapter);
    const stored = storedIdentity();
    const { adapter } = setup({ udn: "", mac: "", httpsPort: 8443 });
    const i = internalOf(adapter);
    expect(configOf(adapter).https?.cert).toBe(stored.tlsCert);
    expect(i.log.info).not.toHaveBeenCalledWith(expect.stringContaining("stored self-signed TLS certificate"));
  });

  it("regenerates an expired certificate and stores only that", () => {
    forgeControl.notAfter = new Date("2020-01-01T00:00:00Z");
    const { adapter } = setup({ httpsPort: 8443, tlsCert: PERSISTED_CERT, tlsKey: PERSISTED_KEY });
    const i = internalOf(adapter);
    const config = configOf(adapter);
    expect(config.https?.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("expired"));
    expect(storedIdentity()).toEqual({
      udn: "12345678-1234-1234-1234-123456789abc",
      tlsCert: expect.stringContaining("GENERATED"),
      privateKey: config.https?.key,
    });
    expect(rawIdentity().privateKey).toEqual(sealedKey(config.https?.key ?? ""));
  });

  it("regenerates the pair when the key in the earlier settings cannot be decrypted", () => {
    const { adapter } = setup({ httpsPort: 8443, tlsCert: PERSISTED_CERT, tlsKey: "$/aes-192-cbc:broken" });
    const i = internalOf(adapter);
    i.decrypt.mockImplementation(() => {
      throw new Error("bad decrypt");
    });
    expect(configOf(adapter).https?.cert).toContain("GENERATED");
  });

  // Design decision 36: the identity file is readable and holds the UDN, only the write of a TLS pair generated
  // later in the start fails — this run serves with the pair and warns; the stored identity stays as it was.
  it("serves a generated certificate it cannot store for this run and keeps the stored identity", () => {
    configOf(setup({ udn: "", mac: "" }).adapter);
    const stored = readFileSync(join(dataDir.current, "identity.json"), "utf8");
    // A folder where the master writes its temporary file — the file stays readable, the write fails.
    mkdirSync(join(dataDir.current, "identity.json.tmp"));
    const { adapter } = setup({ udn: "", mac: "", httpsPort: 8443 });
    const i = internalOf(adapter);
    const config = configOf(adapter);
    expect(config.https?.cert).toContain("GENERATED");
    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be stored"));
    expect(i.log.info).not.toHaveBeenCalledWith(expect.stringContaining("stored self-signed TLS certificate"));
    expect(readFileSync(join(dataDir.current, "identity.json"), "utf8")).toBe(stored);
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

  // Audit R-24: a converted legacy light is a light object — served on the same start, no restart.
  it("serves a converted legacy light as light 1 on the same start", async () => {
    const { adapter, servers, handlers } = setup();
    const i = internalOf(adapter);
    const db = objectDb(adapter);
    // One legacy device object with an `on` state child.
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.legacylight", common: { name: "Old Lamp" } }]);
    // Never migrated yet: it still carries its legacy `.name` wrapper (v1.19.0, Q17).
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "legacylight.name" ? { type: "state" } : null),
    );
    i.getStatesOfAsync.mockResolvedValue([{ _id: "hueemu.0.legacylight.state.on" }]);
    await i.onReady();

    expect(db.get("hueemu.0.lights.1")).toMatchObject({
      type: "device",
      native: { lightType: "onoff", onState: "hueemu.0.legacylight.state.on" },
    });
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith("system.adapter.hueemu.0", expect.anything());
    expect(servers).toHaveLength(1);
    expect((handlers[0].options as { devices: unknown[] }).devices).toEqual([
      expect.objectContaining({ id: 1, name: "Old Lamp", onState: "hueemu.0.legacylight.state.on" }),
    ]);
  });

  // Audit R-24: a first start no longer restarts — the identity goes to the data folder.
  it("serves on a first start right away — the identity goes to the file, native is not written", async () => {
    const { adapter, servers } = setup({ udn: "", mac: "" });
    const i = internalOf(adapter);
    await i.onReady();
    expect(servers).toHaveLength(1);
    expect(storedIdentity().udn).toMatch(/^[0-9a-f-]{36}$/i);
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
  });

  it("drops the old identity from native once the file holds it, and stops for the restart", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      udn: "12345678-1234-1234-1234-123456789abc",
      mac: "AA:BB:CC:DD:EE:FF",
      tlsCert: PERSISTED_CERT,
      tlsKey: PERSISTED_KEY,
    };
    const { adapter, servers } = setup(native);
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "system.adapter.hueemu.0" ? structuredClone({ native, common: {} }) : null),
    );
    await i.onReady();
    expect(storedIdentity().udn).toBe("12345678-1234-1234-1234-123456789abc");
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: { udn: null, tlsCert: null, tlsKey: null },
    });
    expect(servers).toHaveLength(0);
  });

  // S9: a start that cannot store the identity serves nothing and drops nothing — js-controller starts it again.
  it("stops the start and keeps the old identity in native while the file cannot be written", async () => {
    mkdirSync(join(dataDir.current, "identity.json.tmp"));
    const native = { bind: "192.168.1.10", port: 8080, udn: "12345678-1234-1234-1234-123456789abc", mac: "" };
    const { adapter, servers } = setup(native);
    const i = internalOf(adapter);
    i.getForeignObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "system.adapter.hueemu.0" ? structuredClone({ native, common: {} }) : null),
    );
    await i.onReady();
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalled();
    expect(servers).toHaveLength(0);
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("could not be stored"));
    expect(i.setState).toHaveBeenCalledWith("info.error", { ack: true, val: "Unknown" });
    expect(i.terminate).toHaveBeenCalledWith(expect.any(String), 6);
  });

  it("stops the start on an identity file it cannot use, and leaves the file as it is", async () => {
    writeFileSync(join(dataDir.current, "identity.json"), "{ not json");
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(servers).toHaveLength(0);
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("identity.json cannot be used (no JSON"));
    expect(i.terminate).toHaveBeenCalledWith(expect.any(String), 6);
    expect(readFileSync(join(dataDir.current, "identity.json"), "utf8")).toBe("{ not json");
  });

  it("keeps booting when the cleanup of earlier-version objects fails (state handling stays wired)", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    // An object of an earlier version is there — and its delete blows up.
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "info.configuredDevices" ? { type: "state" } : null),
    );
    i.delObjectAsync.mockImplementation((id: string) =>
      id === "info.configuredDevices" ? Promise.reject(new Error("objects db timeout")) : Promise.resolve(),
    );
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

// Fleet rule D10 (inventory "answers an unknown message with an error"): a message gets an answer, never silence.
describe("HueEmu onMessage", () => {
  const message = (command: string, callback?: ioBroker.MessageCallbackInfo): ioBroker.Message => ({
    command,
    from: "system.adapter.admin.0",
    message: {},
    callback,
    _id: 1,
  });
  const callback = { message: {}, id: 7, ack: false, time: 0 } as ioBroker.MessageCallbackInfo;

  it("listens on the message event once I18n is ready", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    expect(i.on).not.toHaveBeenCalledWith("message", expect.any(Function));
    await i.onReady();
    expect(i.on).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("answers a command it does not know with an error the sender can read", () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.onMessage(message("inventoryUnknownCommand", callback));
    expect(i.sendTo).toHaveBeenCalledWith(
      "system.adapter.admin.0",
      "inventoryUnknownCommand",
      { error: expect.stringContaining("inventoryUnknownCommand") },
      callback,
    );
  });

  it("leaves the device manager's commands to dm-utils", () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.onMessage(message("dm:loadDevices", callback));
    expect(i.sendTo).not.toHaveBeenCalled();
  });

  it("sends nothing for a message that waits for no answer", () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    i.onMessage(message("inventoryUnknownCommand"));
    expect(i.sendTo).not.toHaveBeenCalled();
  });
});

describe("HueEmu onStateChange", () => {
  async function ready(overrides: Record<string, unknown> = {}): Promise<ReturnType<typeof setup>> {
    const ctx = setup(overrides);
    await internalOf(ctx.adapter).onReady();
    return ctx;
  }

  it("startPairing=true enables pairing and arms the 50s timeout", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);

    expect(adapter.pairingEnabled).toBe(true);
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
    expect(i.log.debug).toHaveBeenCalledWith(expect.stringContaining("automatically disabled"));
  });

  // krobi 2026-10-16 07:49 „feedback ungleich spam“: switching a button datapoint is
  // routine — its state is the feedback, the log stays at debug.
  it("writes no info line when pairing or authentication is switched", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.log.info.mockClear();
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);
    (i.setTimeout.mock.calls.at(-1)![0] as () => void)();
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: false } as ioBroker.State);
    i.onStateChange("hueemu.0.startPairing", { val: false, ack: false } as ioBroker.State);
    i.onStateChange("hueemu.0.disableAuth", { val: true, ack: false } as ioBroker.State);
    i.onStateChange("hueemu.0.disableAuth", { val: false, ack: false } as ioBroker.State);
    expect(i.log.info).not.toHaveBeenCalled();
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

  it("forwards acked changes into the API handler's state cache (device binding)", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hue.0.light.bri", { val: 80, ack: true, from: "system.adapter.hue.0" } as ioBroker.State);
    // v1.19.0 (H6): the writer goes along — the binding's scale anchor ignores its own writes.
    expect(handlers[0].onStateChange).toHaveBeenCalledWith("hue.0.light.bri", 80, "system.adapter.hue.0");
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
    expect(handlers[0].onStateChange).toHaveBeenCalledWith("hue.0.light.bri", 80, undefined);
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

  // v1.19.0 (audit 2026-09-25 H12): deleting a paired client in the admin revokes it at
  // once — the key used to stay valid until the next adapter start.
  it("revokes a client whose state was deleted", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    i.onStateChange("hueemu.0.clients.living_room", null);
    expect(handlers[0].forgetClient).toHaveBeenCalledWith("living_room");
    expect(handlers[0].forgetState).not.toHaveBeenCalled();
  });

  // H-06 (krobi 2026-11-11 16:59): a log line names an own client object by the id clients.json holds; an object of an
  // earlier version — its id and its value were the key — by the last four characters of its id, without its value.
  it("names a client object by its id in the state lines, an earlier version's object without its key", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    const key = "16f8b066-5b1e-4c3a-9d2f-0a1b2c3dac37";
    (i as unknown as { clients: { add(key: string, devicetype: string): string } }).clients.add(key, "Harmony Hub");
    i.log.debug.mockClear();
    i.onStateChange("hueemu.0.clients.harmony-hub-ac37", { val: "Harmony Hub", ack: true } as ioBroker.State);
    i.onStateChange(`hueemu.0.clients.${key}`, { val: key, ack: true } as ioBroker.State);
    i.onStateChange(`hueemu.0.user.${key}`, null);
    const lines = i.log.debug.mock.calls.map(call => String(call[0])).filter(line => line.startsWith("State "));
    expect(lines).toEqual([
      "State hueemu.0.clients.harmony-hub-ac37 changed: Harmony Hub (ack = true)",
      "State hueemu.0.clients.…ac37 changed: … (ack = true)",
      "State hueemu.0.user.…ac37 deleted",
    ]);
  });

  it("revokes a client whose object was deleted, and watches the client objects for it", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    expect(i.subscribeObjects).toHaveBeenCalledWith("clients.*");
    i.onObjectChange("hueemu.0.clients.echo", null);
    expect(handlers[0].forgetClient).toHaveBeenCalledWith("echo");
    // A changed (not deleted) client object and a foreign object revoke nothing.
    i.onObjectChange("hueemu.0.clients.other", { _id: "x" } as unknown as ioBroker.Object);
    i.onObjectChange("zigbee.0.lamp", null);
    expect(handlers[0].forgetClient).toHaveBeenCalledTimes(1);
  });

  it("logs instead of throwing when revoking a deleted client fails", async () => {
    const { adapter, handlers } = await ready();
    const i = internalOf(adapter);
    handlers[0].forgetClient.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => i.onObjectChange("hueemu.0.clients.echo", null)).not.toThrow();
    expect(i.log.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });

  // N4: `hueemu.1` must not take `hueemu.10.*` for its own and acknowledge it.
  it("does not treat another instance's states as its own", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.setState.mockClear();
    i.onStateChange("hueemu.00.something", { val: 1, ack: false } as ioBroker.State);
    expect(i.setState).not.toHaveBeenCalled();
  });

  // js-controller 7.2.2 validator.ts warns about a write without ack on a write:false
  // datapoint; confirming it would turn a stray write into the adapter's own statement.
  it("does not confirm a write to one of its read-only datapoints", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.setState.mockClear();
    i.onStateChange("hueemu.0.info.connection", { val: true, ack: false } as ioBroker.State);
    i.onStateChange("hueemu.0.info.error", { val: "x", ack: false } as ioBroker.State);
    i.onStateChange("hueemu.0.clients.echo", { val: "y", ack: false } as ioBroker.State);
    expect(i.setState).not.toHaveBeenCalled();
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

  it("takes a confirmed write to its own switches as a report, never as a command", async () => {
    const { adapter } = await ready();
    const i = internalOf(adapter);
    i.setState.mockClear();
    i.setTimeout.mockClear();
    // The adapter's own ack of startPairing/disableAuth comes back as a stateChange with ack: true — acting on it again
    // would arm a second pairing window, or flip the auth switch from a report.
    i.onStateChange("hueemu.0.startPairing", { val: true, ack: true } as ioBroker.State);
    i.onStateChange("hueemu.0.disableAuth", { val: true, ack: true } as ioBroker.State);
    expect(adapter.pairingEnabled).toBe(false);
    expect(adapter.disableAuth).toBe(false);
    expect(i.setTimeout).not.toHaveBeenCalled();
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
    i.buildConfig = () => {
      const config = original();
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

  // v1.19.0 (audit 2026-09-25 Q18): the stop can also come while SSDP binds — the
  // socket is released and no announce interval is left behind.
  it("releases SSDP and sets up no pulse when the unload arrives while SSDP binds", async () => {
    const { adapter, ssdps } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as { makeSsdpServer: (o: unknown) => FakeSsdp };
    const origFactory = internal.makeSsdpServer.bind(adapter);
    const callback = vi.fn();
    internal.makeSsdpServer = (o: unknown) => {
      const s = origFactory(o);
      s.start.mockImplementation(() => {
        i.onUnload(callback);
        return Promise.resolve();
      });
      return s;
    };
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(ssdps[0].stop).toHaveBeenCalled();
    expect(ssdps[0].announce).not.toHaveBeenCalled();
    expect(i.setInterval).not.toHaveBeenCalled();
    expect(i.setState).not.toHaveBeenCalledWith("info.connection", expect.objectContaining({ val: true }));
  });

  // Q18: a stop during the cleanup of earlier versions' objects must not be followed
  // by "connected".
  it("does not report connected when the unload arrives during the cleanup", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const callback = vi.fn();
    i.getObjectAsync.mockImplementation((id: string) => {
      // The last read of the start: the cleanup's check for the last obsolete id.
      if (id === "createLight") {
        i.onUnload(callback);
      }
      return Promise.resolve(null);
    });
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(i.setState).not.toHaveBeenCalledWith("info.connection", expect.objectContaining({ val: true }));
  });

  // Audit 2026-09-25 Q34: the other two stop points of the start — right after the
  // own objects were refreshed, and right after the handler came up.
  it("stops after refreshing the own objects when the unload arrives there", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    const callback = vi.fn();
    i.extendObject.mockImplementation((id: string) => {
      if (id === "clients") {
        i.onUnload(callback);
      }
      return Promise.resolve();
    });
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(servers).toHaveLength(0);
  });

  it("stops after the handler came up when the unload arrives there", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    const internal = adapter as unknown as { makeApiHandler: (o: unknown) => FakeApiHandler };
    const origFactory = internal.makeApiHandler.bind(adapter);
    const callback = vi.fn();
    internal.makeApiHandler = (o: unknown) => {
      const h = origFactory(o);
      h.initialize.mockImplementation(() => {
        i.onUnload(callback);
        return Promise.resolve();
      });
      return h;
    };
    await i.onReady();
    await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
    expect(servers).toHaveLength(0);
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

  it("the manifest declares the clients container as a folder (decision 24)", () => {
    // js-controller merges the manifest's object type into the existing object on every
    // start — the manifest is the only place that keeps `clients` from being a `meta`
    // again (a state under a meta object is repochecker E2001).
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "io-package.json"), "utf8")) as {
      instanceObjects: { _id: string; type: string }[];
    };
    expect(manifest.instanceObjects.find(o => o._id === "clients")?.type).toBe("folder");
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

// The client keys left the object tree (B02 audit_own_native_at_runtime, krobi 2026-11-05 22:46: secrets as a file in
// the instance data folder): clients.json holds them, the objects are `clients.<model>-<last four of the key>`. The
// move itself is proven in client-move.test.ts — here, where onReady runs it and what it hands on.
describe("HueEmu prepareClients (client keys in the data folder)", () => {
  /** A client object as v1.19.0 stored it. */
  const legacyRow = {
    id: "hueemu.0.clients.echo-key",
    value: { type: "state", common: { name: "Echo", type: "string", role: "text" }, native: { username: "echo-key" } },
  };

  /** What clients.json in this test's data folder holds. */
  function storedClients(): Record<string, unknown> {
    return storedClientKeys(dataDir.current, MAIN_CIPHER);
  }

  it("moves a client of an earlier version before the own objects are refreshed and the bridge serves", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getObjectListAsync.mockImplementation((q: { startkey: string }) =>
      Promise.resolve({ rows: q.startkey === "hueemu.0.clients." ? [legacyRow] : [] }),
    );
    await i.onReady();
    expect(storedClients()).toEqual({ clients: { "echo-okey": "echo-key" } });
    expect(i.setObjectNotExistsAsync).toHaveBeenCalledWith(
      "clients.echo-okey",
      expect.objectContaining({ native: {} }),
    );
    expect(i.delObjectAsync).toHaveBeenCalledWith("clients.echo-key");
    const deleted =
      i.delObjectAsync.mock.invocationCallOrder[
        i.delObjectAsync.mock.calls.findIndex(c => c[0] === "clients.echo-key")
      ];
    const refreshed =
      i.extendObject.mock.invocationCallOrder[i.extendObject.mock.calls.findIndex(c => c[0] === "clients")];
    expect(deleted).toBeLessThan(refreshed);
    expect(deleted).toBeLessThan(servers[0].start.mock.invocationCallOrder[0]);
    // …and before anything listens to the client objects: the move's delete must revoke nobody.
    expect(deleted).toBeLessThan(i.subscribeObjects.mock.invocationCallOrder[0]);
  });

  it("hands the loaded client keys to the handler", async () => {
    const { adapter, handlers } = setup();
    const i = internalOf(adapter);
    i.getObjectListAsync.mockImplementation((q: { startkey: string }) =>
      Promise.resolve({ rows: q.startkey === "hueemu.0.clients." ? [legacyRow] : [] }),
    );
    await i.onReady();
    const options = handlers[0].options as { clients: { keyOf: (id: string) => string | undefined } };
    expect(options.clients.keyOf("echo-okey")).toBe("echo-key");
  });

  it("keeps starting, and warns, when the clients cannot be moved", async () => {
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    i.getObjectListAsync.mockImplementation((q: { startkey: string }) =>
      q.startkey === "hueemu.0.clients."
        ? Promise.reject(new Error("objects db timeout"))
        : Promise.resolve({ rows: [] }),
    );
    await i.onReady();
    expect(i.log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not be brought to the current form — the next start tries again: objects db timeout",
      ),
    );
    expect(servers).toHaveLength(1);
    expect(i.log.info).toHaveBeenCalledWith(expect.stringContaining("Hue Emulator running"));
  });

  it("warns about a clients.json it cannot use, keeps it, and serves", async () => {
    writeFileSync(join(dataDir.current, "clients.json"), "{ broken");
    const { adapter, servers } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(i.log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/clients\.json cannot be used \(no JSON: .*\) — paired clients must pair again/),
    );
    expect(readFileSync(join(dataDir.current, "clients.json"), "utf8")).toBe("{ broken");
    expect(servers).toHaveLength(1);
  });

  it("starts quietly on an installation without paired clients", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    await i.onReady();
    expect(i.log.warn).not.toHaveBeenCalled();
    expect(i.delObjectAsync).not.toHaveBeenCalled();
  });
});

describe("HueEmu migrateLegacyDevices", () => {
  /**
   * A start on one legacy device of the given state leaves.
   *
   * @param leaves the state leaves below `<device>.state`
   */
  async function startOnLegacy(
    leaves: string[],
  ): Promise<{ i: ReturnType<typeof internalOf>; db: Map<string, Record<string, unknown>> }> {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const db = objectDb(adapter);
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.colorlamp", common: { name: "Color Lamp" } }]);
    // Never migrated yet: it still carries its legacy `.name` wrapper (v1.19.0, Q17).
    i.getObjectAsync.mockImplementation((id: string) =>
      Promise.resolve(id === "colorlamp.name" ? { type: "state" } : null),
    );
    i.getStatesOfAsync.mockResolvedValue(leaves.map(leaf => ({ _id: `hueemu.0.colorlamp.state.${leaf}` })));
    await i.onReady();
    return { i, db };
  }

  it("skips when a light object exists — the device objects are not read on every start", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    objectDb(adapter, { "hueemu.0.lights.1": lightDevice("X", { lightType: "onoff", onState: "x.on" }) });
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.colorlamp", common: { name: "Color Lamp" } }]);
    await i.onReady();
    expect(i.getDevicesAsync).not.toHaveBeenCalled();
  });

  it("creates nothing when there are no legacy device objects", async () => {
    const { adapter } = setup();
    const db = objectDb(adapter);
    await internalOf(adapter).onReady();
    expect([...db.keys()].filter(id => id.startsWith("hueemu.0.lights."))).toEqual([]);
  });

  it("maps legacy state children to the right light type and state ids", async () => {
    const { db } = await startOnLegacy(["on", "bri", "hue", "sat"]);
    const native = db.get("hueemu.0.lights.1")?.native as Record<string, unknown>;
    expect(native.lightType).toBe("color");
    expect(native.onState).toBe("hueemu.0.colorlamp.state.on");
    expect(native.hueState).toBe("hueemu.0.colorlamp.state.hue");
    expect(native.xyState).toBeUndefined(); // xy not present in legacy states
  });

  it("keeps the device + channel container objects, deleting only the obsolete .name/.data wrappers (L2)", async () => {
    const { i } = await startOnLegacy(["on"]);
    const deleted = i.delObjectAsync.mock.calls.map(c => c[0]);
    // Obsolete metadata wrappers are removed...
    expect(deleted).toContain("colorlamp.name");
    expect(deleted).toContain("colorlamp.data");
    // ...but the parents of the retained leaf states must NOT be orphaned.
    expect(deleted).not.toContain("colorlamp.state");
    expect(deleted).not.toContain("colorlamp");
  });
});

describe("HueEmu light objects (audit R-24)", () => {
  const ICON = expect.stringMatching(/^data:image\/svg\+xml;base64,/) as unknown;

  // The first start of this version moves the settings' lights into light objects — an unnumbered list by position —
  // and only then drops the two keys from native; that write restarts the instance, so the start stops there.
  it("moves the settings' lights into light objects, then drops them from native and stops for the restart", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [
        { name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { name: "Hall", lightType: "dimmable", briState: "h.bri" },
      ],
      lastLightId: 0,
    };
    const { adapter, servers } = setup(native);
    const i = internalOf(adapter);
    const db = objectDb(adapter, {}, native);

    await i.onReady();

    expect(db.get("hueemu.0.lights.1")).toEqual({
      type: "device",
      common: {
        name: expect.objectContaining({ en: "Kitchen", de: "Kitchen" }) as unknown,
        icon: ICON,
      },
      native: { lightType: "onoff", onState: "k.on" },
    });
    expect(db.get("hueemu.0.lights.2")).toMatchObject({ native: { lightType: "dimmable", briState: "h.bri" } });
    expect([...db.keys()].filter(id => /^hueemu\.0\.lights\.\d+\./.test(id))).toEqual([]);
    expect(storedMark()).toBe(2);
    expect(i.extendForeignObjectAsync).toHaveBeenCalledWith("system.adapter.hueemu.0", {
      native: { devices: null, lastLightId: null },
    });
    expect(servers).toHaveLength(0);
  });

  // Audit R-02: an entry without a number continues above the mark — it never gets a deleted light's number back.
  it("numbers an entry without a number above the settings' mark", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [
        { id: 1, name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { name: "Lost", lightType: "onoff", onState: "l.on" },
      ],
      lastLightId: 4,
    };
    const { adapter } = setup(native);
    const db = objectDb(adapter, {}, native);
    await internalOf(adapter).onReady();
    expect(db.get("hueemu.0.lights.5")).toMatchObject({ native: { onState: "l.on" } });
    expect(db.has("hueemu.0.lights.2")).toBe(false);
    expect(storedMark()).toBe(5);
  });

  it("keeps a light object a cut-off move already wrote, and creates only the missing ones", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [
        { id: 1, name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { id: 2, name: "Hall", lightType: "onoff", onState: "h.on" },
      ],
    };
    const { adapter } = setup(native);
    const i = internalOf(adapter);
    const kept = lightDevice("Kitchen renamed", { lightType: "onoff", onState: "k2.on" });
    const db = objectDb(adapter, { "hueemu.0.lights.1": kept }, native);
    await i.onReady();
    expect(i.setForeignObject.mock.calls.map(c => c[0])).not.toContain("hueemu.0.lights.1");
    expect(db.get("hueemu.0.lights.2")).toMatchObject({ native: { onState: "h.on" } });
  });

  it("serves the settings' lights and keeps them in native when the light objects cannot be written", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [{ name: "Kitchen", lightType: "onoff", onState: "k.on" }],
    };
    const { adapter, servers, handlers } = setup(native);
    const i = internalOf(adapter);
    objectDb(adapter, {}, native);
    i.setForeignObject.mockRejectedValue(new Error("objects db down"));

    await i.onReady();

    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be moved out of the instance settings"));
    expect(i.extendForeignObjectAsync).not.toHaveBeenCalledWith("system.adapter.hueemu.0", expect.anything());
    expect(servers).toHaveLength(1);
    expect((handlers[0].options as { devices: unknown[] }).devices).toEqual([
      expect.objectContaining({ id: 1, name: "Kitchen", onState: "k.on" }),
    ]);
    // The served list stays this run: no live reload, and nothing written below lights that are not there.
    expect(i.subscribeObjects).not.toHaveBeenCalledWith("lights.*");
    expect(i.setState.mock.calls.map(c => String(c[0])).filter(id => id.includes("lights."))).toEqual([]);
  });

  // A run that could not read the tree for the move serves the settings' lights — a light the device manager adds
  // meanwhile must not take one of their numbers (and with it a paired client's uniqueid).
  it("covers the settings' light numbers with the mark when the move could not read the tree", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [
        { id: 4, name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { name: "Hall", lightType: "onoff", onState: "h.on" },
      ],
    };
    const { adapter, handlers } = setup(native);
    const i = internalOf(adapter);
    objectDb(adapter, {}, native);
    i.getObjectListAsync.mockRejectedValueOnce(new Error("objects db busy"));

    await i.onReady();

    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be moved out of the instance settings"));
    expect((handlers[0].options as { devices: Array<{ id: number }> }).devices.map(d => d.id)).toEqual([4, 5]);
    expect(storedMark()).toBe(5);
  });

  // The settings' lights are served and their numbers are not in the tree: a legacy device converted in this run would
  // be numbered past an empty tree — light 1, the number of the settings' light and of a paired client's uniqueid.
  it("converts no legacy device while it serves the settings' lights", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [{ id: 1, name: "Kitchen", lightType: "onoff", onState: "k.on" }],
    };
    const { adapter } = setup(native);
    const i = internalOf(adapter);
    const db = objectDb(adapter, {}, native);
    i.getObjectListAsync.mockRejectedValueOnce(new Error("objects db busy"));
    i.getDevicesAsync.mockResolvedValue([{ _id: "hueemu.0.colorlamp", common: { name: "Color Lamp" } }]);

    await i.onReady();

    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be moved out of the instance settings"));
    expect(i.getDevicesAsync).not.toHaveBeenCalled();
    expect([...db.keys()].filter(id => id.startsWith("hueemu.0.lights."))).toEqual([]);
  });

  // A cut-off move left light 1 behind and light 2 cannot be written: the run serves the settings' lights, and the
  // light objects get their form on the start that moves the rest.
  it("brings no light object up to date in a run that serves the settings' lights", async () => {
    const native = {
      bind: "192.168.1.10",
      port: 8080,
      devices: [
        { id: 1, name: "Kitchen", lightType: "onoff", onState: "k.on" },
        { id: 2, name: "Hall", lightType: "onoff", onState: "h.on" },
      ],
    };
    const { adapter } = setup(native);
    const i = internalOf(adapter);
    objectDb(adapter, { "hueemu.0.lights.1": lightDevice("Kitchen", { lightType: "onoff", onState: "k.on" }) }, native);
    i.setForeignObject.mockRejectedValue(new Error("objects db down"));

    await i.onReady();

    expect(i.log.warn).toHaveBeenCalledWith(expect.stringContaining("could not be moved out of the instance settings"));
    expect(
      i.extendForeignObjectAsync.mock.calls.map(c => String(c[0])).filter(id => id.startsWith("hueemu.0.lights.")),
    ).toEqual([]);
  });

  it("serves the stored light objects, numbered by their id, named in the system language", async () => {
    const { adapter, handlers } = setup();
    (adapter as unknown as { language: string }).language = "de";
    objectDb(adapter, {
      "hueemu.0.lights.7": {
        type: "device",
        common: { name: { en: "Bulb", de: "Birne" } },
        native: { lightType: "ct", onState: "z.on", ctState: "z.ct" },
      },
    });
    await internalOf(adapter).onReady();
    expect((handlers[0].options as { devices: unknown[] }).devices).toEqual([
      { id: 7, name: "Birne", lightType: "ct", onState: "z.on", ctState: "z.ct" },
    ]);
  });

  it("boots normally for an installation without lights", async () => {
    const { adapter, servers } = setup();
    objectDb(adapter);
    await internalOf(adapter).onReady();
    expect(servers).toHaveLength(1);
  });

  // The fleet rule "rewrites no object unchanged": a light from before gets its pictogram exactly once; the next start
  // writes no light object at all.
  it("brings an existing light object to the current form once, and writes nothing on the next start", async () => {
    const seed = { "hueemu.0.lights.3": lightDevice("Desk", { lightType: "onoff", onState: "d.on" }) };
    const first = setup();
    const db = objectDb(first.adapter, seed);
    await internalOf(first.adapter).onReady();
    expect(db.get("hueemu.0.lights.3")).toMatchObject({
      common: { name: { en: "Desk" }, icon: ICON },
      native: { lightType: "onoff", onState: "d.on" },
    });
    expect([...db.keys()].filter(id => id.startsWith("hueemu.0.lights.3."))).toEqual([]);

    const second = setup();
    const i = internalOf(second.adapter);
    objectDb(second.adapter, Object.fromEntries(db));
    await i.onReady();
    const lightWrites = [...i.setForeignObject.mock.calls, ...i.extendForeignObjectAsync.mock.calls].filter(c =>
      String(c[0]).startsWith("hueemu.0.lights."),
    );
    expect(lightWrites).toEqual([]);
    expect(i.log.debug).not.toHaveBeenCalledWith(expect.stringContaining("light object(s) up to the current form"));
  });

  it("raises the number mark to a light number above it — a light deleted later keeps its number taken", async () => {
    const { adapter } = setup();
    objectDb(adapter, { "hueemu.0.lights.9": lightDevice("Copy", { lightType: "onoff", onState: "c.on" }) });
    writeFileSync(join(dataDir.current, "light-ids.json"), JSON.stringify({ lastLightId: 4 }));
    await internalOf(adapter).onReady();
    expect(storedMark()).toBe(9);
  });

  it("subscribes the light objects only after its own writes of the start", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    objectDb(adapter, { "hueemu.0.lights.3": lightDevice("Desk", { lightType: "onoff", onState: "d.on" }) });
    await i.onReady();
    const subscribed =
      i.subscribeObjects.mock.invocationCallOrder[i.subscribeObjects.mock.calls.findIndex(c => c[0] === "lights.*")];
    const lastLightWrite = Math.max(
      ...i.extendForeignObjectAsync.mock.calls.map((c, n) =>
        String(c[0]).startsWith("hueemu.0.lights.") ? i.extendForeignObjectAsync.mock.invocationCallOrder[n] : 0,
      ),
      ...i.setForeignObject.mock.calls.map((c, n) =>
        String(c[0]).startsWith("hueemu.0.lights.") ? i.setForeignObject.mock.invocationCallOrder[n] : 0,
      ),
    );
    expect(lastLightWrite).toBeGreaterThan(0);
    expect(subscribed).toBeGreaterThan(lastLightWrite);
  });

  // krobi 2026-11-11 14:27: a light only links datapoints of the same installation — a reachability datapoint would
  // say nothing, so the adapter keeps none: no object below a light, no write there, not at the stop either.
  it("keeps no datapoint below a light — none created, none written at start, on a change or at the stop", async () => {
    const { adapter, handlers } = setup();
    const i = internalOf(adapter);
    const db = objectDb(adapter, {
      "hueemu.0.lights.1": lightDevice("A", { lightType: "onoff", onState: "a.on" }),
    });
    await i.onReady();
    i.onStateChange("a.on", { val: true, ack: true, ts: 1, lc: 1, from: "x", q: 0 });
    i.onStateChange("a.on", null);
    expect(handlers[0].forgetState).toHaveBeenCalledWith("a.on");
    await new Promise<void>(resolve => i.onUnload(resolve));
    expect([...db.keys()].filter(id => id.startsWith("hueemu.0.lights.1."))).toEqual([]);
    expect(i.setState.mock.calls.map(c => String(c[0])).filter(id => id.includes("lights."))).toEqual([]);
  });

  describe("a changed light object is served at once", () => {
    /** A started adapter serving light 3, and its database. */
    async function started(): Promise<{
      i: ReturnType<typeof internalOf>;
      handler: FakeApiHandler;
      db: Map<string, Record<string, unknown>>;
    }> {
      const { adapter, handlers } = setup();
      const i = internalOf(adapter);
      const db = objectDb(adapter, {
        "hueemu.0.lights.3": lightDevice("Desk", { lightType: "onoff", onState: "d.on" }),
      });
      await i.onReady();
      return { i, handler: handlers[0], db };
    }

    it("reads the list again when a light's device object changes, and hands it to the bridge", async () => {
      const { i, handler, db } = await started();
      db.set("hueemu.0.lights.4", lightDevice("Hall", { lightType: "onoff", onState: "h.on" }));
      i.onObjectChange("hueemu.0.lights.4", db.get("hueemu.0.lights.4") as unknown as ioBroker.Object);
      await vi.waitFor(() => expect(handler.replaceDevices).toHaveBeenCalledTimes(1));
      expect(handler.replaceDevices).toHaveBeenCalledWith([
        expect.objectContaining({ id: 3, name: "Desk" }),
        expect.objectContaining({ id: 4, name: "Hall", onState: "h.on" }),
      ]);
    });

    it("serves a deleted light no more", async () => {
      const { i, handler, db } = await started();
      db.delete("hueemu.0.lights.3");
      i.onObjectChange("hueemu.0.lights.3", null);
      await vi.waitFor(() => expect(handler.replaceDevices).toHaveBeenCalledWith([]));
    });

    // A light copied in the object browser takes its number at once — deleted before the next start, that number
    // must still never come back.
    it("raises the number mark to a light added while it runs", async () => {
      const { i, handler, db } = await started();
      db.set("hueemu.0.lights.8", lightDevice("Copy", { lightType: "onoff", onState: "c.on" }));
      i.onObjectChange("hueemu.0.lights.8", db.get("hueemu.0.lights.8") as unknown as ioBroker.Object);
      await vi.waitFor(() => expect(handler.replaceDevices).toHaveBeenCalledTimes(1));
      expect(storedMark()).toBe(8);
    });

    it("hands nothing to the bridge after the stop", async () => {
      const { i, handler, db } = await started();
      await new Promise<void>(resolve => i.onUnload(() => resolve()));
      db.set("hueemu.0.lights.4", lightDevice("Hall", { lightType: "onoff", onState: "h.on" }));
      i.onObjectChange("hueemu.0.lights.4", db.get("hueemu.0.lights.4") as unknown as ioBroker.Object);
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      expect(handler.replaceDevices).not.toHaveBeenCalled();
    });

    it("ignores a change of a datapoint below a light — one someone made there by hand", async () => {
      const { i, handler } = await started();
      i.onObjectChange("hueemu.0.lights.3.note", { type: "state" } as unknown as ioBroker.Object);
      await new Promise(resolve => setImmediate(resolve));
      expect(handler.replaceDevices).not.toHaveBeenCalled();
    });

    it("hands nothing over when the list did not change (a pictogram refresh)", async () => {
      const { i, handler, db } = await started();
      i.onObjectChange("hueemu.0.lights.3", db.get("hueemu.0.lights.3") as unknown as ioBroker.Object);
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
      expect(handler.replaceDevices).not.toHaveBeenCalled();
    });

    it("reads once more after changes that came in while a reload ran", async () => {
      const { i, handler, db } = await started();
      let release: () => void = () => {};
      handler.replaceDevices.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)));
      db.set("hueemu.0.lights.4", lightDevice("Hall", { lightType: "onoff", onState: "h.on" }));
      i.onObjectChange("hueemu.0.lights.4", null);
      await vi.waitFor(() => expect(handler.replaceDevices).toHaveBeenCalledTimes(1));
      db.set("hueemu.0.lights.5", lightDevice("Porch", { lightType: "onoff", onState: "p.on" }));
      i.onObjectChange("hueemu.0.lights.5", null);
      i.onObjectChange("hueemu.0.lights.5", null);
      release();
      await vi.waitFor(() => expect(handler.replaceDevices).toHaveBeenCalledTimes(2));
      expect(handler.replaceDevices.mock.calls[1][0]).toHaveLength(3);
    });
  });
});

describe("HueEmu refreshInstanceObjects (v1.15.0)", () => {
  it("re-applies all three manifest objects on every start", async () => {
    // js-controller merges instanceObjects on every start but keeps common.name, so a
    // changed name would otherwise reach fresh installs only — the manifest looks
    // right while every existing tree keeps the old text.
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
    // The object type comes from the manifest, which js-controller merges into the
    // existing object on each start — the refresh writes names only. The old
    // `meta.folder` is NOT removed via a null in this patch (js-controller warns on
    // it every start); the cleanup runs as a separate read + setForeignObject.
    expect(byId.get("clients")).not.toHaveProperty("type");
    expect(byId.get("clients")?.common).not.toHaveProperty("type");
    // Every object carries an explanation, the folder included.
    expect(byId.get("clients")?.common?.desc).toEqual({ en: "clientsFolderDesc" });
    expect(byId.get("info.connection")?.common?.desc).toEqual({ en: "infoConnectionDesc" });
  });

  // Inventory "rewrites no object unchanged": an unchanged write still stamps `ts` and wakes every subscriber.
  it("writes no own object whose stored form already carries its name and description", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const texts: Record<string, Record<string, unknown>> = {
      startPairing: { name: { en: "startPairingName" }, desc: { en: "startPairingDesc" } },
      disableAuth: { name: { en: "disableAuthName" }, desc: { en: "disableAuthDesc" } },
      info: { name: { en: "infoFolder" } },
      "info.connection": { name: { en: "infoConnectionName" }, desc: { en: "infoConnectionDesc" } },
      "info.error": { name: { en: "infoErrorName" }, desc: { en: "infoErrorDesc" } },
      clients: { name: { en: "clientsFolder" }, desc: { en: "clientsFolderDesc" } },
      lights: { name: { en: "lightsFolder" }, desc: { en: "lightsFolderDesc" } },
    };
    objectDb(
      adapter,
      Object.fromEntries(
        Object.entries(texts).map(([id, common]) => [
          `hueemu.0.${id}`,
          { _id: `hueemu.0.${id}`, type: "state", common: { role: "text", ...common } },
        ]),
      ),
    );
    await i.onReady();
    const written = i.extendObject.mock.calls.map(c => c[0] as string).filter(id => id in texts);
    expect(written).toEqual([]);
  });

  it("writes only the text that differs from the stored object", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    objectDb(adapter, {
      "hueemu.0.info.error": {
        _id: "hueemu.0.info.error",
        type: "state",
        common: { name: { en: "an older name" }, desc: { en: "infoErrorDesc" } },
      },
    });
    await i.onReady();
    expect(i.extendObject.mock.calls.filter(c => c[0] === "info.error")).toEqual([
      ["info.error", { common: { name: { en: "infoErrorName" }, desc: { en: "infoErrorDesc" } } }],
    ]);
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

  // GV-28 (krobi 2026-10-03 12:01): an adapter that cannot communicate has a fatal error — inventory "a taken port".
  it("ends with an error that js-controller restarts once the listener cannot open — after its writes are done", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    const busy = "listen EADDRINUSE: address already in use 0.0.0.0:8080";
    (adapter as unknown as { makeHueServer: (o: unknown) => FakeHueServer }).makeHueServer = options => ({
      start: vi.fn(() => Promise.reject(new Error(busy))),
      stop: vi.fn(() => Promise.resolve()),
      options,
    });
    const done: string[] = [];
    i.setState.mockImplementation(async (id: string) => {
      await Promise.resolve();
      done.push(id);
    });
    i.terminate.mockImplementation(() => done.push("terminate"));
    await i.onReady();
    expect(i.terminate).toHaveBeenCalledWith(expect.any(String), 6);
    expect(done.slice(-3).sort()).toEqual(["info.connection", "info.error", "terminate"].sort());
    expect(done.at(-1)).toBe("terminate");
  });

  it("does not end the process when a stop already came during the failed start", async () => {
    const { adapter } = setup();
    const i = internalOf(adapter);
    (adapter as unknown as { makeHueServer: (o: unknown) => FakeHueServer }).makeHueServer = options => ({
      start: vi.fn(() => {
        (adapter as unknown as { unloaded: boolean }).unloaded = true;
        return Promise.reject(new Error("listen EADDRINUSE"));
      }),
      stop: vi.fn(() => Promise.resolve()),
      options,
    });
    await i.onReady();
    expect(i.terminate).not.toHaveBeenCalled();
  });

  it("strips the stale meta common.type WITHOUT the null patch js-controller rejects", async () => {
    // `extendObject(… common: { type: null })` does delete the field, but
    // js-controller validates the PATCH first and logs "obj.common.type has an
    // invalid type … will throw an error up from js-controller version 7.0.0"
    // on every start of every installation (measured 2026-09-06). Read + rewrite
    // touches the object only when there is really something to remove.
    const { adapter } = setup();
    const i = internalOf(adapter);
    objectDb(adapter, {
      "hueemu.0.clients": {
        _id: "hueemu.0.clients",
        type: "folder",
        common: { name: { en: "Clients" }, type: "meta.folder" },
      },
    });
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
    objectDb(adapter, { "hueemu.0.clients": { _id: "hueemu.0.clients", type: "folder", common: { name: {} } } });
    await i.onReady();
    expect(i.setForeignObject.mock.calls.filter((c: unknown[]) => c[0] === "hueemu.0.clients")).toEqual([]);
    expect(i.log.debug).not.toHaveBeenCalledWith(expect.stringContaining("Removed the stale common.type"));
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
    const writes: [string, unknown][] = [];
    i.setState.mockImplementation((id: string, state: unknown) => {
      writes.push([id, state]);
      return Promise.resolve();
    });
    let doneAfter = -1;
    await new Promise<void>(resolve =>
      i.onUnload(() => {
        doneAfter = writes.length;
        resolve();
      }),
    );
    // Audit R-09: the values too, not only the ids — off and the fleet reason word.
    expect(writes).toEqual([
      ["info.connection", { ack: true, val: false }],
      ["info.error", { ack: true, val: "Unknown" }],
    ]);
    expect(doneAfter).toBe(2);
  });
});
