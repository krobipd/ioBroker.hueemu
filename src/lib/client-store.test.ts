import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AUTO_PAIRED_DEVICETYPE,
  CLIENTS_FILE,
  ClientStore,
  UNKNOWN_DEVICETYPE,
  UNREADABLE_CLIENTS_FILE,
  clientIdFor,
  clientModel,
  isClientId,
  slugOf,
} from "./client-store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hueemu-client-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** What the file holds. */
function stored(): unknown {
  return JSON.parse(readFileSync(join(dir, CLIENTS_FILE), "utf8"));
}

/** A store on this test's folder, loaded. */
function loaded(): ClientStore {
  const store = new ClientStore(dir);
  expect(store.load()).toBeUndefined();
  return store;
}

/** A key as a Harmony Hub pairs with — a uuid the bridge generated (made up here). */
const HARMONY_KEY = "0b1c2d3e-4f50-4617-8899-aabbccddac37";

describe("slugOf", () => {
  it("writes a text as an id part", () => {
    expect(slugOf("Harmony Hub")).toBe("harmony-hub");
    expect(slugOf("Echo#Wohnzimmer")).toBe("echo-wohnzimmer");
    expect(slugOf("  --Bosch SHC--  ")).toBe("bosch-shc");
    expect(slugOf("Küche Größe")).toBe("kueche-groesse");
    expect(slugOf("Gerät")).toBe("geraet");
    expect(slugOf("Café")).toBe("cafe");
    expect(slugOf("a.b_c")).toBe("a-b-c");
  });

  it("writes one hyphen for a run of anything but letters and digits", () => {
    expect(slugOf("Echo  (Dot)")).toBe("echo-dot");
    expect(slugOf("Harmony - Hub")).toBe("harmony-hub");
  });

  it("leaves nothing of a text without letters or digits", () => {
    expect(slugOf("")).toBe("");
    expect(slugOf("#*.")).toBe("");
  });
});

describe("clientModel", () => {
  it("takes the device type as the model", () => {
    expect(clientModel("Harmony Hub")).toBe("harmony-hub");
    expect(clientModel(" Echo ")).toBe("echo");
  });

  it("takes `client` where the client named no device type", () => {
    for (const devicetype of [
      UNKNOWN_DEVICETYPE,
      AUTO_PAIRED_DEVICETYPE,
      ` ${UNKNOWN_DEVICETYPE} `,
      "",
      "#",
      5,
      null,
      undefined,
    ]) {
      expect(clientModel(devicetype)).toBe("client");
    }
  });
});

describe("clientIdFor", () => {
  it("joins the model and the last four letters or digits of the key", () => {
    expect(clientIdFor("Harmony Hub", HARMONY_KEY, new Set())).toBe("harmony-hub-ac37");
    expect(clientIdFor("Echo", "AB-CD.E", new Set())).toBe("echo-bcde");
    expect(clientIdFor("Echo", "x9", new Set())).toBe("echo-x9");
  });

  it("takes the model alone when the key has no letter or digit", () => {
    expect(clientIdFor("Echo", "-._", new Set())).toBe("echo");
  });

  it("counts on when another client holds the id", () => {
    expect(clientIdFor("Harmony Hub", HARMONY_KEY, new Set(["harmony-hub-ac37"]))).toBe("harmony-hub-ac37-2");
    expect(clientIdFor("Harmony Hub", HARMONY_KEY, new Set(["harmony-hub-ac37", "harmony-hub-ac37-2"]))).toBe(
      "harmony-hub-ac37-3",
    );
  });

  it("gives an id of the current form for any device type and key", () => {
    for (const [devicetype, key] of [
      ["Harmony Hub", HARMONY_KEY],
      ["#", "#"],
      [UNKNOWN_DEVICETYPE, "inventory-fixture-client"],
      ["Ä Ö Ü", "ÄÖÜ"],
    ]) {
      expect(isClientId(clientIdFor(devicetype, key, new Set()))).toBe(true);
    }
  });
});

describe("isClientId", () => {
  it("knows a client id of the current form", () => {
    for (const suffix of ["harmony-hub-ac37", "client", "echo-x9-2", "1"]) {
      expect(isClientId(suffix)).toBe(true);
    }
  });

  it("knows no other text as one", () => {
    for (const suffix of ["", "-a", "a-", "a--b", "A", "a.b", "a_b", " a", "harmony hub"]) {
      expect(isClientId(suffix)).toBe(false);
    }
  });
});

describe("ClientStore", () => {
  it("holds nothing before the first pairing", () => {
    const store = loaded();
    expect(store.ids()).toEqual([]);
    expect(store.readable).toBe(true);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
  });

  it("names each key after its device type and stores it before it returns", () => {
    const store = loaded();
    expect(store.add(HARMONY_KEY, "Harmony Hub")).toBe("harmony-hub-ac37");
    expect(stored()).toEqual({ clients: { "harmony-hub-ac37": HARMONY_KEY } });
    expect(store.add("echo-key", "Echo")).toBe("echo-okey");
    expect(stored()).toEqual({ clients: { "echo-okey": "echo-key", "harmony-hub-ac37": HARMONY_KEY } });
  });

  // The id is handed out once: a client pairing again under another device type keeps it.
  it("gives a stored key its id again, whatever device type it names now", () => {
    const store = loaded();
    store.add("key-a", "Echo");
    store.add("key-b", "Echo");
    expect(store.add("key-a", "Harmony Hub")).toBe("echo-keya");
    expect(store.ids()).toEqual(["echo-keya", "echo-keyb"]);
  });

  it("counts on for a second client of one model with the same four characters", () => {
    const store = loaded();
    expect(store.add("first-abcd", "Echo")).toBe("echo-abcd");
    expect(store.add("second-abcd", "Echo")).toBe("echo-abcd-2");
    expect(store.keyOf("echo-abcd-2")).toBe("second-abcd");
  });

  it("finds a key by its id and an id by its key", () => {
    const store = loaded();
    store.add("key-a", "Echo");
    expect(store.keyOf("echo-keya")).toBe("key-a");
    expect(store.idOf("key-a")).toBe("echo-keya");
    expect(store.keyOf("echo-keyb")).toBeUndefined();
    expect(store.idOf("other")).toBeUndefined();
  });

  it("removes a key and stores that", () => {
    const store = loaded();
    store.add("key-a", "Echo");
    store.add("key-b", "Echo");
    expect(store.remove("echo-keyb")).toBe("key-b");
    expect(stored()).toEqual({ clients: { "echo-keya": "key-a" } });
  });

  it("removes nothing for an id it does not hold — and writes nothing", () => {
    const store = loaded();
    store.add("key-a", "Echo");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.remove("echo-keyb")).toBeUndefined();
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
    expect(store.keyOf("echo-keya")).toBe("key-a");
  });

  it("reads back what it stored", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { "echo-okey": "echo-key", client: "c" } }));
    const store = loaded();
    expect(store.ids()).toEqual(["client", "echo-okey"]);
    expect(store.keyOf("echo-okey")).toBe("echo-key");
    expect(store.add("other-okey", "Echo")).toBe("echo-okey-2");
  });

  it("skips an entry that is no client id or holds no key", () => {
    writeFileSync(
      join(dir, CLIENTS_FILE),
      JSON.stringify({ clients: { "": "a", "Echo-1": "b", "a.b": "c", "echo-x": "", "echo-y": 4, "echo-z": "z" } }),
    );
    expect(loaded().ids()).toEqual(["echo-z"]);
  });

  it("reads an empty table from a file without a client list", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: ["a", "b"] }));
    const store = loaded();
    expect(store.ids()).toEqual([]);
    expect(store.add("new-k", "Echo")).toBe("echo-newk");
  });

  // A file it cannot read is never taken for an empty one: nothing it holds is overwritten.
  it("names why it cannot use a file and keeps the file", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const store = new ClientStore(dir);
    expect(store.load()).toMatch(/^no JSON: /);
    expect(store.readable).toBe(false);
    expect(store.ids()).toEqual([]);
    expect(readFileSync(join(dir, CLIENTS_FILE), "utf8")).toBe("{ broken");
  });

  it("calls a file that holds no table unusable", () => {
    for (const content of ["[1, 2]", '"text"', "null"]) {
      writeFileSync(join(dir, CLIENTS_FILE), content);
      const store = new ClientStore(dir);
      expect(store.load()).toBe("no table in it");
      expect(store.readable).toBe(false);
    }
  });

  it("sets an unusable file aside before it writes a new one", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const store = new ClientStore(dir);
    store.load();
    expect(store.add("key-a", "Echo")).toBe("echo-keya");
    expect(readFileSync(join(dir, UNREADABLE_CLIENTS_FILE), "utf8")).toBe("{ broken");
    expect(stored()).toEqual({ clients: { "echo-keya": "key-a" } });
    expect(store.readable).toBe(true);
  });

  it("writes a new file when the unusable one is gone meanwhile", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const store = new ClientStore(dir);
    store.load();
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.add("key-a", "Echo")).toBe("echo-keya");
    expect(existsSync(join(dir, UNREADABLE_CLIENTS_FILE))).toBe(false);
    expect(stored()).toEqual({ clients: { "echo-keya": "key-a" } });
  });

  it("keeps the table as it was when a new key cannot be stored", () => {
    const blocked = join(dir, "not-a-folder");
    writeFileSync(blocked, "");
    const store = new ClientStore(blocked);
    store.load();
    expect(() => store.add("key-a", "Echo")).toThrow();
    expect(store.ids()).toEqual([]);
    expect(store.idOf("key-a")).toBeUndefined();
    // The failed attempt holds no id either: the next client of that id gets it without a counter.
    rmSync(blocked);
    expect(store.add("key-a", "Echo")).toBe("echo-keya");
  });

  it("forgets a removed key even when the file cannot be written", () => {
    const store = loaded();
    store.add("key-a", "Echo");
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "");
    expect(() => store.remove("echo-keya")).toThrow();
    expect(store.keyOf("echo-keya")).toBeUndefined();
    rmSync(dir);
  });

  it("forgets every key whose object is gone and stores that once", () => {
    const store = loaded();
    store.add("a", "Echo");
    store.add("b", "Echo");
    store.add("c", "Echo");
    expect(store.keepOnly(new Set(["echo-b"]))).toBe(2);
    expect(stored()).toEqual({ clients: { "echo-b": "b" } });
  });

  it("writes nothing when every key still has its object", () => {
    const store = loaded();
    store.add("a", "Echo");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.keepOnly(new Set(["echo-a"]))).toBe(0);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
  });

  // An object without a file entry (the file was lost) or an old object the move deletes keeps its id.
  it("never hands out an id the tree holds", () => {
    const store = loaded();
    store.reserve(["echo-keya", "echo-keya-2"]);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
    expect(store.add("key-a", "Echo")).toBe("echo-keya-3");
    expect(store.ids()).toEqual(["echo-keya-3"]);
  });

  it("starts over from an empty table on every load", () => {
    const store = loaded();
    store.add("a", "Echo");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.load()).toBeUndefined();
    expect(store.ids()).toEqual([]);
  });

  it("ignores the number mark of a file written before the ids carried the model", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 7, clients: { "echo-okey": "echo-key" } }));
    const store = loaded();
    store.add("key-a", "Echo");
    expect(stored()).toEqual({ clients: { "echo-keya": "key-a", "echo-okey": "echo-key" } });
  });
});
