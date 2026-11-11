import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLIENTS_FILE, ClientStore, UNREADABLE_CLIENTS_FILE, clientNumberOf, isClientNumber } from "./client-store";

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

describe("clientNumberOf", () => {
  it("reads the number of a client id", () => {
    expect(clientNumberOf("1")).toBe(1);
    expect(clientNumberOf("12")).toBe(12);
  });

  it("reads no number from anything else — an old `clients.<key>` included", () => {
    // The last one is too big for a number: it reads as Infinity, no client number.
    for (const suffix of ["", "0", "01", "-1", "1.5", "1e3", "x", "echo-key", " 1", `1${"0".repeat(400)}`]) {
      expect(clientNumberOf(suffix)).toBeUndefined();
    }
  });

  it("knows a client number", () => {
    expect(isClientNumber(3)).toBe(true);
    for (const value of [0, -1, 1.5, Number.NaN, "3", undefined]) {
      expect(isClientNumber(value)).toBe(false);
    }
  });
});

describe("ClientStore", () => {
  it("holds nothing before the first pairing", () => {
    const store = loaded();
    expect(store.numbers()).toEqual([]);
    expect(store.readable).toBe(true);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
  });

  it("numbers the keys one after the other and stores each before it returns", () => {
    const store = loaded();
    expect(store.add("key-a")).toBe(1);
    expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "key-a" } });
    expect(store.add("key-b")).toBe(2);
    expect(stored()).toEqual({ lastClientId: 2, clients: { 1: "key-a", 2: "key-b" } });
  });

  it("gives a stored key its number again", () => {
    const store = loaded();
    store.add("key-a");
    store.add("key-b");
    expect(store.add("key-a")).toBe(1);
    expect(store.numbers()).toEqual([1, 2]);
  });

  it("finds a key by its number and a number by its key", () => {
    const store = loaded();
    store.add("key-a");
    expect(store.keyOf(1)).toBe("key-a");
    expect(store.numberOf("key-a")).toBe(1);
    expect(store.keyOf(2)).toBeUndefined();
    expect(store.numberOf("other")).toBeUndefined();
  });

  // A new pairing must never inherit the room, function and recording of a deleted client.
  it("never hands out a number twice — not after a removal, not after a restart", () => {
    const store = loaded();
    store.add("key-a");
    store.add("key-b");
    expect(store.remove(2)).toBe("key-b");
    expect(stored()).toEqual({ lastClientId: 2, clients: { 1: "key-a" } });
    expect(store.add("key-c")).toBe(3);
    const again = loaded();
    expect(again.add("key-d")).toBe(4);
  });

  it("removes nothing for a number it does not hold — and writes nothing", () => {
    const store = loaded();
    store.add("key-a");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.remove(5)).toBeUndefined();
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
    expect(store.keyOf(1)).toBe("key-a");
  });

  it("reads back what it stored, the mark above the highest kept number included", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 7, clients: { 2: "b", 5: "e" } }));
    const store = loaded();
    expect(store.numbers()).toEqual([2, 5]);
    expect(store.keyOf(5)).toBe("e");
    expect(store.add("new")).toBe(8);
  });

  it("takes the highest kept number as the mark when the file names none", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ clients: { 4: "d" } }));
    expect(loaded().add("new")).toBe(5);
  });

  it("skips an entry that is no client number or holds no key", () => {
    writeFileSync(
      join(dir, CLIENTS_FILE),
      JSON.stringify({ lastClientId: "9", clients: { 0: "a", "01": "b", x: "c", 3: "", 4: 4, 6: "f" } }),
    );
    const store = loaded();
    expect(store.numbers()).toEqual([6]);
    expect(store.add("new")).toBe(7);
  });

  it("reads an empty table from a file without a client list", () => {
    writeFileSync(join(dir, CLIENTS_FILE), JSON.stringify({ lastClientId: 3, clients: ["a", "b"] }));
    const store = loaded();
    expect(store.numbers()).toEqual([]);
    expect(store.add("new")).toBe(4);
  });

  // A file it cannot read is never taken for an empty one: nothing it holds is overwritten.
  it("names why it cannot use a file and keeps the file", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const store = new ClientStore(dir);
    expect(store.load()).toMatch(/^no JSON: /);
    expect(store.readable).toBe(false);
    expect(store.numbers()).toEqual([]);
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
    expect(store.add("key-a")).toBe(1);
    expect(readFileSync(join(dir, UNREADABLE_CLIENTS_FILE), "utf8")).toBe("{ broken");
    expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "key-a" } });
    expect(store.readable).toBe(true);
  });

  it("writes a new file when the unusable one is gone meanwhile", () => {
    writeFileSync(join(dir, CLIENTS_FILE), "{ broken");
    const store = new ClientStore(dir);
    store.load();
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.add("key-a")).toBe(1);
    expect(existsSync(join(dir, UNREADABLE_CLIENTS_FILE))).toBe(false);
    expect(stored()).toEqual({ lastClientId: 1, clients: { 1: "key-a" } });
  });

  it("keeps the table as it was when a new key cannot be stored", () => {
    const blocked = join(dir, "not-a-folder");
    writeFileSync(blocked, "");
    const store = new ClientStore(blocked);
    store.load();
    expect(() => store.add("key-a")).toThrow();
    expect(store.numbers()).toEqual([]);
    expect(store.numberOf("key-a")).toBeUndefined();
    // The failed attempt took no number either.
    rmSync(blocked);
    expect(store.add("key-b")).toBe(1);
  });

  it("forgets a removed key even when the file cannot be written", () => {
    const store = loaded();
    store.add("key-a");
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "");
    expect(() => store.remove(1)).toThrow();
    expect(store.keyOf(1)).toBeUndefined();
    rmSync(dir);
  });

  it("forgets every key whose object is gone and stores that once", () => {
    const store = loaded();
    store.add("a");
    store.add("b");
    store.add("c");
    expect(store.keepOnly(new Set([2]))).toBe(2);
    expect(stored()).toEqual({ lastClientId: 3, clients: { 2: "b" } });
  });

  it("writes nothing when every key still has its object", () => {
    const store = loaded();
    store.add("a");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.keepOnly(new Set([1]))).toBe(0);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
  });

  it("raises the mark to the numbers in the tree with the next write", () => {
    const store = loaded();
    store.raiseMark([4, 2]);
    expect(existsSync(join(dir, CLIENTS_FILE))).toBe(false);
    expect(store.add("new")).toBe(5);
    store.raiseMark([1]);
    expect(store.add("next")).toBe(6);
  });

  it("starts over from an empty table on every load", () => {
    const store = loaded();
    store.add("a");
    rmSync(join(dir, CLIENTS_FILE));
    expect(store.load()).toBeUndefined();
    expect(store.numbers()).toEqual([]);
    expect(store.add("b")).toBe(1);
  });
});
