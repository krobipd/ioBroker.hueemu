import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }) },
}));

import { CLIENTS_FILE, ClientStore } from "./client-store";
import { clientCommon, moveClients, nameText, type ClientMoveAdapter } from "./client-move";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hueemu-client-move-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const NS = "hueemu.0";

/** What clients.json holds. */
function stored(): unknown {
  return JSON.parse(readFileSync(join(dir, CLIENTS_FILE), "utf8"));
}

type LogFn = (msg: string) => void;

/** The fake: the adapter's object and state calls over an in-memory database, as spies. */
interface Fake extends ClientMoveAdapter {
  objects: Map<string, Record<string, unknown>>;
  states: Map<string, ioBroker.State>;
  enums: Record<string, { type: string; common: { name: string; members: string[] } }>;
  log: { debug: Mock<LogFn>; info: Mock<LogFn>; warn: Mock<LogFn> };
  setObjectNotExistsAsync: Mock<ClientMoveAdapter["setObjectNotExistsAsync"]>;
  setState: Mock<ClientMoveAdapter["setState"]>;
  delObjectAsync: Mock<ClientMoveAdapter["delObjectAsync"]>;
  setForeignObject: Mock<ClientMoveAdapter["setForeignObject"]>;
}

/**
 * An adapter whose tree holds the given objects (ids without the namespace) and state values.
 *
 * @param objects the objects
 * @param states the state values
 */
function fake(
  objects: Record<string, Record<string, unknown>> = {},
  states: Record<string, Partial<ioBroker.State>> = {},
): Fake {
  const db = new Map(Object.entries(objects).map(([id, obj]) => [`${NS}.${id}`, obj]));
  const values = new Map(Object.entries(states).map(([id, st]) => [id, st as ioBroker.State]));
  const adapter: Fake = {
    namespace: NS,
    objects: db,
    states: values,
    enums: {},
    log: { debug: vi.fn<LogFn>(), info: vi.fn<LogFn>(), warn: vi.fn<LogFn>() },
    getObjectAsync: id =>
      Promise.resolve(structuredClone((db.get(`${NS}.${id}`) as ioBroker.Object | undefined) ?? null)),
    getObjectListAsync: ({ startkey, endkey }) =>
      Promise.resolve({
        rows: [...db.entries()]
          .filter(([id]) => id >= startkey && id <= endkey)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, value]) => ({ id, value: structuredClone(value) })),
      }),
    getStateAsync: id => Promise.resolve(structuredClone(values.get(id) ?? null)),
    setObjectNotExistsAsync: vi.fn<ClientMoveAdapter["setObjectNotExistsAsync"]>((id, obj) => {
      if (!db.has(`${NS}.${id}`)) {
        db.set(`${NS}.${id}`, structuredClone(obj));
      }
      return Promise.resolve({ id });
    }),
    setState: vi.fn<ClientMoveAdapter["setState"]>((id, state) => {
      values.set(id, structuredClone(state) as ioBroker.State);
      return Promise.resolve(id);
    }),
    delObjectAsync: vi.fn<ClientMoveAdapter["delObjectAsync"]>(id => {
      db.delete(`${NS}.${id}`);
      values.delete(id);
      return Promise.resolve();
    }),
    getForeignObjectsAsync: () => Promise.resolve(structuredClone(adapter.enums)),
    getForeignObjectAsync: id => Promise.resolve(structuredClone(adapter.enums[id] ?? null)),
    setForeignObject: vi.fn<ClientMoveAdapter["setForeignObject"]>((id, obj) => {
      adapter.enums[id] = structuredClone(obj) as Fake["enums"][string];
      return Promise.resolve();
    }),
  };
  return adapter;
}

/**
 * A client object as v1.19.0 stored it.
 *
 * @param key the key — in native, as v1.19.0 kept it
 * @param name its common.name
 * @param extra more common fields
 */
function v119Client(key: string, name: unknown = "Echo", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "state",
    common: { name, desc: { en: "clientDesc" }, type: "string", role: "text", read: true, write: false, ...extra },
    native: { username: key },
  };
}

/**
 * A client object in the current form.
 *
 * @param name the device type it paired with
 */
function currentClient(name = "Echo"): Record<string, unknown> {
  return { type: "state", common: clientCommon(name), native: {} };
}

/** The store over this test's folder, loaded. */
function store(): ClientStore {
  const s = new ClientStore(dir);
  s.load();
  return s;
}

/**
 * The ids of the client objects in the fake's tree.
 *
 * @param adapter the fake
 */
function clientIds(adapter: Fake): string[] {
  return [...adapter.objects.keys()].filter(id => id.startsWith(`${NS}.clients.`)).sort();
}

describe("nameText", () => {
  it("reads a bare string, the English text of a translation object, or the fallback", () => {
    expect(nameText("Echo", "x")).toBe("Echo");
    expect(nameText({ en: "Harmony", de: "Harmonie" }, "x")).toBe("Harmony");
    for (const name of [undefined, "", { de: "nur deutsch" }, { en: "" }, 5]) {
      expect(nameText(name, "fallback")).toBe("fallback");
    }
  });
});

describe("clientCommon", () => {
  it("names the client after its device type in every language and explains the datapoint", () => {
    const common = clientCommon("Echo#Kitchen");
    expect(Object.keys(common.name as object)).toHaveLength(11);
    expect((common.name as Record<string, string>).en).toBe("Echo#Kitchen");
    expect(common).toMatchObject({
      desc: { en: "clientDesc" },
      type: "string",
      role: "text",
      read: true,
      write: false,
    });
  });
});

describe("moveClients", () => {
  it("moves a client of v1.19.0 to clients.1 — the key into clients.json, nothing of it left in the tree", async () => {
    const adapter = fake(
      { "clients.echo-key": v119Client("echo-key") },
      { "clients.echo-key": { val: "echo-key", lc: 1_600_000_000_000 } },
    );
    const s = store();
    const result = await moveClients(adapter, s, String);
    expect(result).toEqual({ moved: 1, keyless: 0, forgotten: 0 });
    expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "echo-key" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.1`]);
    const moved = adapter.objects.get(`${NS}.clients.1`) as { native: object; common: Record<string, unknown> };
    expect(moved.native).toEqual({});
    expect(JSON.stringify(moved)).not.toContain("echo-key");
    expect(adapter.states.get("clients.1")?.val).toBe("Echo");
    expect(adapter.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Moved 1 paired client(s) to numbered objects"),
    );
  });

  // Audit R-07: the pairing time is the state's last change — the move hands it over.
  it("carries the pairing time over", async () => {
    const adapter = fake(
      { "clients.k": v119Client("k") },
      { "clients.k": { val: "k", ts: 1_800_000_000_000, lc: 1_600_000_000_000 } },
    );
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.1", { val: "Echo", ack: true, lc: 1_600_000_000_000 });
  });

  it("takes the object's time as the pairing time when the old state has none", async () => {
    const adapter = fake({ "clients.k": { ...v119Client("k"), ts: 1_650_000_000_000 } });
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.1", { val: "Echo", ack: true, lc: 1_650_000_000_000 });
  });

  it("writes the value without a time when nothing names one", async () => {
    const adapter = fake({ "clients.k": v119Client("k") });
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.1", { val: "Echo", ack: true });
  });

  // The datapoint keeps its value type — what hangs on it moves with it (the user's recording, krobi 2026-09-02).
  it("moves what hangs on the datapoint with it", async () => {
    const custom = { "history.0": { enabled: true } };
    const adapter = fake({ "clients.k": v119Client("k", "Echo", { custom, smartName: "Echo" }) });
    await moveClients(adapter, store(), String);
    expect((adapter.objects.get(`${NS}.clients.1`) as { common: Record<string, unknown> }).common).toMatchObject({
      custom,
      smartName: "Echo",
      type: "string",
      role: "text",
    });
  });

  it("lifts a bare legacy name to all eleven languages and keeps a translation object as it is", async () => {
    const adapter = fake({
      "clients.a": v119Client("a", "Echo"),
      "clients.b": v119Client("b", { en: "Harmony", de: "Harmonie" }),
    });
    await moveClients(adapter, store(), String);
    const name = (n: number): unknown =>
      (adapter.objects.get(`${NS}.clients.${n}`) as { common: { name: unknown } }).common.name;
    expect(Object.keys(name(1) as object)).toHaveLength(11);
    expect((name(1) as Record<string, string>).de).toBe("Echo");
    expect(name(2)).toEqual({ en: "Harmony", de: "Harmonie" });
    expect(adapter.states.get("clients.2")?.val).toBe("Harmony");
  });

  it("gives a legacy object without a name, or with an empty one, the device type unknown", async () => {
    const adapter = fake({
      "clients.k": { type: "state", common: {}, native: { username: "k" } },
      "clients.e": { type: "state", common: { name: "" }, native: { username: "e" } },
    });
    await moveClients(adapter, store(), String);
    for (const n of [1, 2]) {
      expect(adapter.states.get(`clients.${n}`)?.val).toBe("unknown");
      expect(
        (adapter.objects.get(`${NS}.clients.${n}`) as { common: { name: Record<string, string> } }).common.name.en,
      ).toBe("unknown");
    }
  });

  it("takes the key from native, else from the state value, else from the id", async () => {
    const adapter = fake(
      {
        "clients.a_b": v119Client("a.b"),
        "clients.from-value": { type: "state", common: { name: "V" } },
        // An empty name in native and a value that is no text name no key.
        "clients.from-id": { type: "state", common: { name: "I" }, native: { username: "" } },
      },
      { "clients.a_b": { val: "ignored" }, "clients.from-value": { val: "real.key" }, "clients.from-id": { val: 7 } },
    );
    await moveClients(adapter, store(), String);
    expect(Object.values((stored() as { clients: Record<string, string> }).clients).sort()).toEqual([
      "a.b",
      "from-id",
      "real.key",
    ]);
  });

  // An old `clients.<key>` whose key is a number: the new number must not be the id of an object still there — the
  // move would delete its own successor.
  it("never gives a moved client the id of an old one still in the tree", async () => {
    const adapter = fake({ "clients.1": v119Client("1", "Old") });
    await moveClients(adapter, store(), String);
    expect(stored()).toEqual({ lastClientId: 2, clients: { 2: "1" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.2`]);
  });

  it("deletes every old object only after the key stands in the file and the new object exists", async () => {
    const adapter = fake({ "clients.k": v119Client("k") });
    adapter.delObjectAsync.mockImplementation(id => {
      expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "k" } });
      expect(adapter.objects.has(`${NS}.clients.1`)).toBe(true);
      adapter.objects.delete(`${NS}.${id}`);
      return Promise.resolve();
    });
    await moveClients(adapter, store(), String);
    expect(adapter.delObjectAsync).toHaveBeenCalledWith("clients.k");
  });

  it("finishes a move a stopped start left half done — same number, no second write", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 1, clients: { 1: "k" } }));
    const adapter = fake(
      { "clients.k": v119Client("k"), "clients.1": currentClient() },
      { "clients.1": { val: "Echo", lc: 5 } },
    );
    await moveClients(adapter, store(), String);
    expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "k" } });
    expect(adapter.setState).not.toHaveBeenCalled();
    expect(clientIds(adapter)).toEqual([`${NS}.clients.1`]);
  });

  it("leaves a client in the current form alone", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 1, clients: { 1: "k" } }));
    const adapter = fake({ "clients.1": currentClient() });
    const result = await moveClients(adapter, store(), String);
    expect(result).toEqual({ moved: 0, keyless: 0, forgotten: 0 });
    expect(adapter.setObjectNotExistsAsync).not.toHaveBeenCalled();
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
    expect(adapter.log.info).not.toHaveBeenCalled();
  });

  it("does nothing at all on a tree without clients", async () => {
    const adapter = fake();
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 0, keyless: 0, forgotten: 0 });
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(adapter.log.info).not.toHaveBeenCalled();
    expect(adapter.log.warn).not.toHaveBeenCalled();
    expect(adapter.log.debug).not.toHaveBeenCalled();
  });

  // Decision 31: a client deleted while the adapter was stopped stays revoked.
  it("forgets a key whose object was deleted while the adapter was stopped", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 2, clients: { 1: "a", 2: "b" } }));
    const adapter = fake({ "clients.1": currentClient() });
    expect((await moveClients(adapter, store(), String)).forgotten).toBe(1);
    expect(stored()).toEqual({ lastClientId: 2, clients: { 1: "a" } });
    expect(adapter.log.debug).toHaveBeenCalledWith("Forgot 1 client key(s) whose object was deleted");
  });

  it("leaves a client object without a stored key in place and says once that it cannot sign in", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 1, clients: { 1: "a" } }));
    const adapter = fake({ "clients.1": currentClient(), "clients.3": currentClient(), "clients.4": currentClient() });
    expect((await moveClients(adapter, store(), String)).keyless).toBe(2);
    expect(clientIds(adapter)).toHaveLength(3);
    expect(adapter.log.warn).toHaveBeenCalledTimes(1);
    expect(adapter.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("2 paired client object(s) have no stored key"),
    );
    // Their numbers stay taken.
    const s = store();
    s.raiseMark([3, 4]);
    expect(s.add("new")).toBe(5);
  });

  // The unusable file was already named at the start — no second warning, and nothing is forgotten on its account.
  it("forgets nothing and adds no warning while clients.json cannot be read", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const adapter = fake({ "clients.1": currentClient() });
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 0, keyless: 1, forgotten: 0 });
    expect(adapter.log.warn).not.toHaveBeenCalled();
    expect(readFileSync(join(dir, CLIENTS_FILE), "utf8")).toBe("{ broken");
  });

  it("keeps the old objects when the key cannot be stored", async () => {
    const blocked = join(dir, "not-a-folder");
    writeFileSync(blocked, "");
    const s = new ClientStore(blocked);
    s.load();
    const adapter = fake({ "clients.k": v119Client("k") });
    await expect(moveClients(adapter, s, String)).rejects.toThrow();
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(clientIds(adapter)).toEqual([`${NS}.clients.k`]);
  });

  it("skips what is no client datapoint below the folder", async () => {
    const adapter = fake({
      "clients.channel": { type: "channel", common: { name: "x" } },
      "clients.a.b": v119Client("deep"),
    });
    expect((await moveClients(adapter, store(), String)).moved).toBe(0);
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
  });

  // Before v1.2.0: `user.<key>`.
  describe("from the user folder before v1.2.0", () => {
    it("moves a client to clients.1 and removes the old folder", async () => {
      const adapter = fake(
        {
          user: { type: "meta", common: { name: "user" } },
          "user.alexa.echo": { type: "state", common: { name: "Echo", type: "string", role: "text" }, native: {} },
        },
        { "user.alexa.echo": { val: "alexa.echo", lc: 1_500_000_000_000 } },
      );
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "alexa.echo" } });
      expect(adapter.setState).toHaveBeenCalledWith("clients.1", { val: "Echo", ack: true, lc: 1_500_000_000_000 });
      expect(adapter.delObjectAsync.mock.calls.map(c => c[0])).toEqual(["user.alexa.echo", "user"]);
    });

    it("takes the key from native first, then from the id", async () => {
      const adapter = fake({
        user: { type: "meta" },
        "user.a": { type: "state", common: { name: "A" }, native: { username: "native.key" } },
        "user.b": { type: "state", common: { name: "B" } },
      });
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ lastClientId: 2, clients: { 1: "native.key", 2: "b" } });
    });

    it("removes an empty old folder", async () => {
      const adapter = fake({ user: { type: "meta" } });
      await moveClients(adapter, store(), String);
      expect(adapter.delObjectAsync.mock.calls.map(c => c[0])).toEqual(["user"]);
      expect(adapter.log.info).not.toHaveBeenCalled();
    });

    it("gives a client found in both folders one number", async () => {
      const adapter = fake({
        user: { type: "meta" },
        "user.k": { type: "state", common: { name: "Old" }, native: { username: "k" } },
        "clients.k": v119Client("k"),
      });
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "k" } });
      expect(clientIds(adapter)).toEqual([`${NS}.clients.1`]);
    });
  });

  // v1.19.0 fleet order (enum-carry.ts): read the enums once, delete every old object, write each enum once.
  describe("room and function assignments", () => {
    it("carries a room to the moved client after deleting the old object", async () => {
      const adapter = fake({ "clients.k": v119Client("k") });
      adapter.enums["enum.rooms.living"] = {
        type: "enum",
        common: { name: "Living", members: [`${NS}.clients.k`, "zigbee.0.lamp"] },
      };
      await moveClients(adapter, store(), String);
      expect(adapter.enums["enum.rooms.living"].common.members).toEqual(["zigbee.0.lamp", `${NS}.clients.1`]);
      expect(adapter.delObjectAsync.mock.invocationCallOrder[0]).toBeLessThan(
        adapter.setForeignObject.mock.invocationCallOrder[0],
      );
    });

    it("writes a room that holds two moved clients once, with both new ids", async () => {
      const adapter = fake({ "clients.a": v119Client("a"), "clients.b": v119Client("b") });
      adapter.enums["enum.rooms.living"] = {
        type: "enum",
        common: { name: "Living", members: [`${NS}.clients.a`, "zigbee.0.lamp", `${NS}.clients.b`] },
      };
      await moveClients(adapter, store(), String);
      expect(adapter.setForeignObject).toHaveBeenCalledTimes(1);
      expect(adapter.enums["enum.rooms.living"].common.members).toEqual([
        "zigbee.0.lamp",
        `${NS}.clients.1`,
        `${NS}.clients.2`,
      ]);
      expect(Math.max(...adapter.delObjectAsync.mock.invocationCallOrder)).toBeLessThan(
        adapter.setForeignObject.mock.invocationCallOrder[0],
      );
    });
  });
});
