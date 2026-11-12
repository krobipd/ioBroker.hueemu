import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }) },
}));

import { CLIENTS_FILE, ClientStore } from "./client-store";
import {
  clientCommon,
  movedAliasTarget,
  moveClients,
  nameText,
  retargetAliases,
  type ClientMoveAdapter,
} from "./client-move";

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
  aliases: Record<string, { type: string; common: { name: string; alias: { id: unknown } }; native: object }>;
  log: { debug: Mock<LogFn>; info: Mock<LogFn>; warn: Mock<LogFn> };
  getForeignObjectsAsync: Mock<ClientMoveAdapter["getForeignObjectsAsync"]>;
  setObjectNotExistsAsync: Mock<ClientMoveAdapter["setObjectNotExistsAsync"]>;
  setState: Mock<ClientMoveAdapter["setState"]>;
  getStatesAsync: Mock<ClientMoveAdapter["getStatesAsync"]>;
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
    aliases: {},
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
    getStatesAsync: vi.fn<ClientMoveAdapter["getStatesAsync"]>(pattern => {
      const prefix = pattern.replace(/\*$/, "");
      return Promise.resolve(
        Object.fromEntries(
          [...values].filter(([id]) => id.startsWith(prefix)).map(([id, st]) => [`${NS}.${id}`, structuredClone(st)]),
        ),
      );
    }),
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
    getForeignObjectsAsync: vi.fn<ClientMoveAdapter["getForeignObjectsAsync"]>(pattern =>
      Promise.resolve(structuredClone(pattern === "alias.*" ? adapter.aliases : adapter.enums)),
    ),
    getForeignObjectAsync: id => Promise.resolve(structuredClone(adapter.enums[id] ?? null)),
    setForeignObject: vi.fn<ClientMoveAdapter["setForeignObject"]>((id, obj) => {
      if (id.startsWith("alias.")) {
        adapter.aliases[id] = structuredClone(obj) as Fake["aliases"][string];
      } else {
        adapter.enums[id] = structuredClone(obj) as Fake["enums"][string];
      }
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

/**
 * An alias state object on a target.
 *
 * @param target `common.alias.id` — a plain id or the read/write pair
 * @param name its name
 */
function alias(target: unknown, name = "Alias"): Fake["aliases"][string] {
  return { type: "state", common: { name, alias: { id: target } }, native: {} };
}

// Fleet rule (krobi 2026-11-12): an adapter that moves datapoints to a new id retargets the aliases on them. The model's
// form and its tests: homeconnect `src/lib/device-move.ts`.
describe("movedAliasTarget", () => {
  const move = (id: string): string | undefined => (id === `${NS}.clients.k` ? `${NS}.clients.echo-k` : undefined);
  it("follows a plain target and each half of a read/write pair", () => {
    expect(movedAliasTarget(`${NS}.clients.k`, move)).toBe(`${NS}.clients.echo-k`);
    expect(movedAliasTarget({ read: `${NS}.clients.k`, write: "js.0.x" }, move)).toEqual({
      read: `${NS}.clients.echo-k`,
      write: "js.0.x",
    });
    expect(movedAliasTarget({ read: "js.0.y", write: `${NS}.clients.k` }, move)).toEqual({
      read: "js.0.y",
      write: `${NS}.clients.echo-k`,
    });
    expect(movedAliasTarget(`${NS}.clients.k2`, move)).toBeUndefined();
    expect(movedAliasTarget(undefined, move)).toBeUndefined();
    expect(movedAliasTarget({ read: 5 }, move)).toBeUndefined();
  });
});

describe("retargetAliases", () => {
  it("rewrites only the aliases that point at something that moves", async () => {
    const written: Record<string, ioBroker.SettableObject> = {};
    const aliases = {
      "alias.0.hub": alias(`${NS}.clients.k`, "Hub"),
      "alias.0.pair": alias({ read: `${NS}.clients.k`, write: "javascript.0.x" }),
      "alias.0.other": alias(`${NS}.clients.echo-k`),
      "alias.0.lamp": alias("zigbee.0.lamp.state"),
      "alias.0.folder": { type: "channel", common: { name: "Folder" }, native: {} },
      "alias.0.gone": null,
    } as unknown as Record<string, ioBroker.Object | null>;
    const count = await retargetAliases(
      aliases,
      id => (id === `${NS}.clients.k` ? `${NS}.clients.echo-k` : undefined),
      (id, obj) => {
        written[id] = obj;
        return Promise.resolve();
      },
    );
    expect(count).toBe(2);
    expect(Object.keys(written).sort()).toEqual(["alias.0.hub", "alias.0.pair"]);
    expect((written["alias.0.hub"].common as { name: string }).name).toBe("Hub");
  });
});

describe("moveClients", () => {
  // krobi 2026-11-11 14:25/14:27: the model it paired as and the last four characters of its key.
  it("moves a client of v1.19.0 to its model and the last four characters of its key — the key into clients.json", async () => {
    const adapter = fake(
      { "clients.echo-key": v119Client("echo-key") },
      { "clients.echo-key": { val: "echo-key", lc: 1_600_000_000_000 } },
    );
    const s = store();
    const result = await moveClients(adapter, s, String);
    expect(result).toEqual({ moved: 1, keyless: 0, forgotten: 0, aliases: 0 });
    expect(stored()).toEqual({ clients: { "echo-okey": "echo-key" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-okey`]);
    const moved = adapter.objects.get(`${NS}.clients.echo-okey`) as { native: object; common: Record<string, unknown> };
    expect(moved.native).toEqual({});
    expect(JSON.stringify(moved)).not.toContain("echo-key");
    expect(adapter.states.get("clients.echo-okey")?.val).toBe("Echo");
    expect(adapter.log.info).toHaveBeenCalledWith(
      expect.stringContaining("Moved 1 paired client(s) to objects named after their device type"),
    );
  });

  it("moves two clients of one model to two ids", async () => {
    const adapter = fake({
      "clients.0b1c2d3e-4f50-4617-8899-aabbccddac37": v119Client("0b1c2d3e-4f50-4617-8899-aabbccddac37", "Harmony Hub"),
      "clients.5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7d3b9": v119Client("5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7d3b9", "Harmony Hub"),
    });
    await moveClients(adapter, store(), String);
    expect(clientIds(adapter)).toEqual([`${NS}.clients.harmony-hub-ac37`, `${NS}.clients.harmony-hub-d3b9`]);
  });

  // Audit R-07: the pairing time is the state's last change — the move hands it over.
  it("carries the pairing time over", async () => {
    const adapter = fake(
      { "clients.k": v119Client("k") },
      { "clients.k": { val: "k", ts: 1_800_000_000_000, lc: 1_600_000_000_000 } },
    );
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.echo-k", { val: "Echo", ack: true, lc: 1_600_000_000_000 });
  });

  it("takes the object's time as the pairing time when the old state has none", async () => {
    const adapter = fake({ "clients.k": { ...v119Client("k"), ts: 1_650_000_000_000 } });
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.echo-k", { val: "Echo", ack: true, lc: 1_650_000_000_000 });
  });

  it("writes the value without a time when nothing names one", async () => {
    const adapter = fake({ "clients.k": v119Client("k") });
    await moveClients(adapter, store(), String);
    expect(adapter.setState).toHaveBeenCalledWith("clients.echo-k", { val: "Echo", ack: true });
  });

  // The datapoint keeps its value type — what hangs on it moves with it (the user's recording, krobi 2026-09-02).
  it("moves what hangs on the datapoint with it", async () => {
    const custom = { "history.0": { enabled: true } };
    const adapter = fake({ "clients.k": v119Client("k", "Echo", { custom, smartName: "Echo" }) });
    await moveClients(adapter, store(), String);
    expect((adapter.objects.get(`${NS}.clients.echo-k`) as { common: Record<string, unknown> }).common).toMatchObject({
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
    const name = (id: string): unknown =>
      (adapter.objects.get(`${NS}.clients.${id}`) as { common: { name: unknown } }).common.name;
    expect(Object.keys(name("echo-a") as object)).toHaveLength(11);
    expect((name("echo-a") as Record<string, string>).de).toBe("Echo");
    expect(name("harmony-b")).toEqual({ en: "Harmony", de: "Harmonie" });
    expect(adapter.states.get("clients.harmony-b")?.val).toBe("Harmony");
  });

  it("gives a legacy object without a name, or with an empty one, the device type unknown and the model client", async () => {
    const adapter = fake({
      "clients.k": { type: "state", common: {}, native: { username: "k" } },
      "clients.e": { type: "state", common: { name: "" }, native: { username: "e" } },
    });
    await moveClients(adapter, store(), String);
    for (const id of ["client-e", "client-k"]) {
      expect(adapter.states.get(`clients.${id}`)?.val).toBe("unknown");
      expect(
        (adapter.objects.get(`${NS}.clients.${id}`) as { common: { name: Record<string, string> } }).common.name.en,
      ).toBe("unknown");
    }
  });

  // Every version up to v1.19.0 wrote the key into native.username — an object without it is the current form.
  it("takes the key of an old client object from its native, never from its value or its id", async () => {
    const adapter = fake(
      {
        "clients.a_b": v119Client("a.b"),
        "clients.from-value": { type: "state", common: { name: "V" } },
        "clients.from-id": { type: "state", common: { name: "I" }, native: { username: "" } },
      },
      { "clients.a_b": { val: "ignored" }, "clients.from-value": { val: "real.key" }, "clients.from-id": { val: 7 } },
    );
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 1, keyless: 2, forgotten: 0, aliases: 0 });
    expect(stored()).toEqual({ clients: { "echo-ab": "a.b" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-ab`, `${NS}.clients.from-id`, `${NS}.clients.from-value`]);
  });

  // An old `clients.<key>` whose key is the id it would move to: the move must not delete its own successor.
  it("never gives a moved client the id of an old one still in the tree", async () => {
    const adapter = fake({ "clients.echo-echo": v119Client("echo-echo") });
    await moveClients(adapter, store(), String);
    expect(stored()).toEqual({ clients: { "echo-echo-2": "echo-echo" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-echo-2`]);
  });

  // An object whose key the file lost keeps its id — a moved client must not take it over.
  it("never gives a moved client the id of an object without a key", async () => {
    const adapter = fake({ "clients.zzz1": v119Client("zzz1"), "clients.echo-zzz1": currentClient() });
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 1, keyless: 1, forgotten: 0, aliases: 0 });
    expect(stored()).toEqual({ clients: { "echo-zzz1-2": "zzz1" } });
    expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-zzz1`, `${NS}.clients.echo-zzz1-2`]);
  });

  it("deletes every old object only after the key stands in the file and the new object exists", async () => {
    const adapter = fake({ "clients.k": v119Client("k") });
    adapter.delObjectAsync.mockImplementation(id => {
      expect(stored()).toEqual({ clients: { "echo-k": "k" } });
      expect(adapter.objects.has(`${NS}.clients.echo-k`)).toBe(true);
      adapter.objects.delete(`${NS}.${id}`);
      return Promise.resolve();
    });
    await moveClients(adapter, store(), String);
    expect(adapter.delObjectAsync).toHaveBeenCalledWith("clients.k");
  });

  it("finishes a move a stopped start left half done — same id, no second write", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-k": "k" } }));
    const adapter = fake(
      { "clients.k": v119Client("k"), "clients.echo-k": currentClient() },
      { "clients.echo-k": { val: "Echo", lc: 5 } },
    );
    await moveClients(adapter, store(), String);
    expect(stored()).toEqual({ clients: { "echo-k": "k" } });
    expect(adapter.setState).not.toHaveBeenCalled();
    expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-k`]);
  });

  it("leaves a client in the current form alone", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-k": "k" } }));
    const adapter = fake({ "clients.echo-k": currentClient() });
    const result = await moveClients(adapter, store(), String);
    expect(result).toEqual({ moved: 0, keyless: 0, forgotten: 0, aliases: 0 });
    expect(adapter.setObjectNotExistsAsync).not.toHaveBeenCalled();
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(adapter.setForeignObject).not.toHaveBeenCalled();
    expect(adapter.log.info).not.toHaveBeenCalled();
  });

  // Inventory "read-only states read one by one": one bulk read per folder, then compared in memory.
  it("reads the states of each folder with one call, never one by one", async () => {
    const adapter = fake(
      {
        user: { type: "meta" },
        "user.a": { type: "state", common: { name: "A" }, native: { username: "user-a" } },
        "user.b": { type: "state", common: { name: "B" } },
        "clients.c": v119Client("c"),
        "clients.d": v119Client("d"),
      },
      { "user.b": { val: "user-b" }, "clients.c": { val: "c", lc: 1 }, "clients.d": { val: "d", lc: 2 } },
    );
    await moveClients(adapter, store(), String);
    expect(adapter.getStatesAsync.mock.calls).toEqual([["user.*"], ["clients.*"]]);
    expect(stored()).toEqual({ clients: { "a-sera": "user-a", "b-serb": "user-b", "echo-c": "c", "echo-d": "d" } });
  });

  it("reads no state while every client is in the current form", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-k": "k" } }));
    const adapter = fake({ "clients.echo-k": currentClient() });
    await moveClients(adapter, store(), String);
    expect(adapter.getStatesAsync).not.toHaveBeenCalled();
  });

  it("does nothing at all on a tree without clients", async () => {
    const adapter = fake();
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 0, keyless: 0, forgotten: 0, aliases: 0 });
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(adapter.log.info).not.toHaveBeenCalled();
    expect(adapter.log.warn).not.toHaveBeenCalled();
    expect(adapter.log.debug).not.toHaveBeenCalled();
  });

  // Decision 31: a client deleted while the adapter was stopped stays revoked.
  it("forgets a key whose object was deleted while the adapter was stopped", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-a": "a", "echo-b": "b" } }));
    const adapter = fake({ "clients.echo-a": currentClient() });
    expect((await moveClients(adapter, store(), String)).forgotten).toBe(1);
    expect(stored()).toEqual({ clients: { "echo-a": "a" } });
    expect(adapter.log.debug).toHaveBeenCalledWith("Forgot 1 client key(s) whose object was deleted");
  });

  it("leaves a client object without a stored key in place and says once that it cannot sign in", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-a": "a" } }));
    const adapter = fake({
      "clients.echo-a": currentClient(),
      "clients.echo-zzz1": currentClient(),
      "clients.echo-zzz2": currentClient(),
    });
    expect((await moveClients(adapter, store(), String)).keyless).toBe(2);
    expect(clientIds(adapter)).toHaveLength(3);
    expect(adapter.log.warn).toHaveBeenCalledTimes(1);
    expect(adapter.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("2 paired client object(s) have no stored key"),
    );
  });

  // The same store pairs the clients of this run: a new client never takes over an object without a key either.
  it("keeps the ids of objects without a key from the pairings of this run", async () => {
    const adapter = fake({ "clients.echo-zzz1": currentClient() });
    const s = store();
    await moveClients(adapter, s, String);
    expect(s.add("new-zzz1", "Echo")).toBe("echo-zzz1-2");
  });

  // The unusable file was already named at the start — no second warning, and nothing is forgotten on its account.
  it("forgets nothing and adds no warning while clients.json cannot be read", async () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const adapter = fake({ "clients.echo-a": currentClient() });
    expect(await moveClients(adapter, store(), String)).toEqual({ moved: 0, keyless: 1, forgotten: 0, aliases: 0 });
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
      "clients.channel": { type: "channel", common: { name: "x" }, native: { username: "chan" } },
      "clients.folder": { type: "folder", common: { name: "y" } },
      "clients.a.b": v119Client("deep"),
    });
    const result = await moveClients(adapter, store(), String);
    expect(result).toEqual({ moved: 0, keyless: 0, forgotten: 0, aliases: 0 });
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
    expect(adapter.log.warn).not.toHaveBeenCalled();
  });

  // Before v1.2.0: `user.<key>`.
  describe("from the user folder before v1.2.0", () => {
    it("moves a client to its model and key and removes the old folder", async () => {
      const adapter = fake(
        {
          user: { type: "meta", common: { name: "user" } },
          "user.alexa.echo": { type: "state", common: { name: "Echo", type: "string", role: "text" }, native: {} },
        },
        { "user.alexa.echo": { val: "alexa.echo", lc: 1_500_000_000_000 } },
      );
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ clients: { "echo-echo": "alexa.echo" } });
      expect(adapter.setState).toHaveBeenCalledWith("clients.echo-echo", {
        val: "Echo",
        ack: true,
        lc: 1_500_000_000_000,
      });
      expect(adapter.delObjectAsync.mock.calls.map(c => c[0])).toEqual(["user.alexa.echo", "user"]);
    });

    it("takes the key from native first, then from the value, then from the id", async () => {
      const adapter = fake(
        {
          user: { type: "meta" },
          "user.a": { type: "state", common: { name: "A" }, native: { username: "native.key" } },
          "user.b": { type: "state", common: { name: "B" } },
          "user.c": { type: "state", common: { name: "C" } },
        },
        { "user.a": { val: "value.akey" }, "user.c": { val: "value.ckey" } },
      );
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ clients: { "a-ekey": "native.key", "b-b": "b", "c-ckey": "value.ckey" } });
    });

    it("removes an empty old folder", async () => {
      const adapter = fake({ user: { type: "meta" } });
      await moveClients(adapter, store(), String);
      expect(adapter.delObjectAsync.mock.calls.map(c => c[0])).toEqual(["user"]);
      expect(adapter.log.info).not.toHaveBeenCalled();
    });

    it("gives a client found in both folders one id", async () => {
      const adapter = fake({
        user: { type: "meta" },
        "user.k": { type: "state", common: { name: "Old" }, native: { username: "k" } },
        "clients.k": v119Client("k"),
      });
      await moveClients(adapter, store(), String);
      expect(stored()).toEqual({ clients: { "old-k": "k" } });
      expect(clientIds(adapter)).toEqual([`${NS}.clients.old-k`]);
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
      expect(adapter.enums["enum.rooms.living"].common.members).toEqual(["zigbee.0.lamp", `${NS}.clients.echo-k`]);
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
        `${NS}.clients.echo-a`,
        `${NS}.clients.echo-b`,
      ]);
      expect(Math.max(...adapter.delObjectAsync.mock.invocationCallOrder)).toBeLessThan(
        adapter.setForeignObject.mock.invocationCallOrder[0],
      );
    });
  });

  // Fleet rule (krobi 2026-11-12): an alias on a moved client points at the new object; a foreign target stays.
  describe("aliases", () => {
    it("points an alias on a moved client at the new object, plain and as a read/write pair", async () => {
      const adapter = fake({ "clients.k": v119Client("k"), user: { type: "meta" }, "user.u": v119Client("u") });
      adapter.aliases = {
        "alias.0.hub": alias(`${NS}.clients.k`, "Hub"),
        "alias.0.pair": alias({ read: "javascript.0.x", write: `${NS}.user.u` }),
        "alias.0.lamp": alias("zigbee.0.lamp.state"),
        "alias.0.current": alias(`${NS}.clients.echo-zzz1`),
      };
      const result = await moveClients(adapter, store(), String);
      expect(result.aliases).toBe(2);
      expect(adapter.aliases["alias.0.hub"]).toEqual(alias(`${NS}.clients.echo-k`, "Hub"));
      expect(adapter.aliases["alias.0.pair"]).toEqual(alias({ read: "javascript.0.x", write: `${NS}.clients.echo-u` }));
      expect(adapter.aliases["alias.0.lamp"]).toEqual(alias("zigbee.0.lamp.state"));
      expect(adapter.aliases["alias.0.current"]).toEqual(alias(`${NS}.clients.echo-zzz1`));
      expect(adapter.setForeignObject.mock.calls.map(c => c[0]).sort()).toEqual(["alias.0.hub", "alias.0.pair"]);
    });

    // Only while the old object stands does a start know where it went.
    it("retargets the aliases before the first old object is deleted", async () => {
      const adapter = fake({ "clients.k": v119Client("k") });
      adapter.aliases = { "alias.0.hub": alias(`${NS}.clients.k`) };
      await moveClients(adapter, store(), String);
      expect(adapter.setForeignObject.mock.invocationCallOrder[0]).toBeLessThan(
        adapter.delObjectAsync.mock.invocationCallOrder[0],
      );
    });

    it("keeps every old object when an alias cannot be written", async () => {
      const adapter = fake({ "clients.k": v119Client("k") });
      adapter.aliases = { "alias.0.hub": alias(`${NS}.clients.k`) };
      adapter.setForeignObject.mockRejectedValue(new Error("objects db down"));
      await expect(moveClients(adapter, store(), String)).rejects.toThrow("objects db down");
      expect(adapter.delObjectAsync).not.toHaveBeenCalled();
      expect(clientIds(adapter)).toEqual([`${NS}.clients.echo-k`, `${NS}.clients.k`]);
    });

    // A start that ended after the aliases but before the delete: the next one finds them on the new id already.
    it("finishes a half-done move without writing an alias that already points at the new object", async () => {
      writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-k": "k" } }));
      const adapter = fake(
        { "clients.k": v119Client("k"), "clients.echo-k": currentClient() },
        { "clients.echo-k": { val: "Echo", lc: 5 } },
      );
      adapter.aliases = {
        "alias.0.done": alias(`${NS}.clients.echo-k`),
        "alias.0.open": alias(`${NS}.clients.k`),
      };
      expect((await moveClients(adapter, store(), String)).aliases).toBe(1);
      expect(adapter.setForeignObject.mock.calls.map(c => c[0])).toEqual(["alias.0.open"]);
      expect(adapter.aliases["alias.0.open"]).toEqual(alias(`${NS}.clients.echo-k`));
    });

    it("reads no alias while nothing moves", async () => {
      writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-k": "k" } }));
      const adapter = fake({ "clients.echo-k": currentClient(), user: { type: "meta" } });
      adapter.aliases = { "alias.0.hub": alias(`${NS}.clients.echo-k`) };
      await moveClients(adapter, store(), String);
      expect(adapter.getForeignObjectsAsync.mock.calls.map(c => c[0])).not.toContain("alias.*");
    });
  });
});
