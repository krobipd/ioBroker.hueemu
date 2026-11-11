/**
 * The client objects of earlier versions in the current form — before the bridge serves, so the first request already
 * reads the moved tree.
 *
 * Up to v1.19.0 a paired client was `clients.<key>`, the key also in `native.username` and as the state value; before
 * v1.2.0 it was `user.<key>`. Both become `clients.<model>-<last four of the key>` (client-store.ts; its name, the
 * device type it paired with, gives the model) with the key in clients.json: the file entry first, then the new
 * object, the old objects last — deleted together and their room and function assignments carried (enum-carry.ts). A
 * start that ends in between finds the key in the file again and gives it the same id.
 *
 * The datapoint keeps its value type: what hangs on it (a recording, a smart name) moves with it. Its value, the key up
 * to v1.19.0, becomes the device type the client paired with; its last change — the pairing time (audit R-07) — is
 * carried over.
 */

import { tName, tRaw } from "./i18n";
import { moveAllWithEnums, type EnumCarryAdapter } from "./enum-carry";
import { ID_RANGE_END } from "./migrations";
import { CLIENTS_FILE, CLIENTS_FOLDER, LEGACY_USER_FOLDER, UNKNOWN_DEVICETYPE, type ClientStore } from "./client-store";

/** What the move needs from the adapter. */
export interface ClientMoveAdapter extends EnumCarryAdapter {
  /** e.g. "hueemu.0" */
  namespace: string;
  /** Reads one own object. */
  getObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
  /** Reads the objects between two full ids. */
  getObjectListAsync(params: {
    startkey: string;
    endkey: string;
  }): Promise<{ rows: Array<{ id: string; value: unknown }> } | null | undefined>;
  /** Reads the own states matching a pattern, keyed by full id. */
  getStatesAsync(pattern: string): Promise<Record<string, ioBroker.State | null | undefined> | null | undefined>;
  /** Creates an own object unless it exists. */
  setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): Promise<unknown>;
  /** Writes an own state. */
  setState(id: string, state: ioBroker.SettableState): Promise<unknown>;
  /** Deletes an own object. */
  delObjectAsync(id: string): Promise<unknown>;
  /** The adapter log. */
  log: { debug: (msg: string) => void; info: (msg: string) => void; warn: (msg: string) => void };
}

/** What a move did. */
export interface ClientMoveResult {
  /** Client objects moved to their current id. */
  moved: number;
  /** Client objects of the current form without a stored key — they cannot sign in. */
  keyless: number;
  /** Stored keys whose object is gone — forgotten. */
  forgotten: number;
}

/**
 * The common of a client object.
 *
 * @param devicetype the device type it paired with — its name, as one text in every language (tRaw)
 */
export function clientCommon(devicetype: string): ioBroker.StateCommon {
  return {
    // A translation object, not a bare string — `common.name` is one for EVERY object type, even where the text comes
    // from the device and has nothing to translate (core team, nut2 #15).
    name: tRaw(devicetype),
    desc: tName("clientDesc"),
    type: "string",
    role: "text",
    read: true,
    write: false,
  };
}

/**
 * The text of a stored name: the string itself (objects before v1.15.1), the English text of a translation object, or
 * the fallback.
 *
 * @param name the object's `common.name`
 * @param fallback what to return when there is nothing readable
 */
export function nameText(name: unknown, fallback: string): string {
  if (typeof name === "string" && name) {
    return name;
  }
  if (name && typeof name === "object") {
    const en = (name as Record<string, unknown>).en;
    if (typeof en === "string" && en) {
      return en;
    }
  }
  return fallback;
}

/**
 * A non-empty text, or undefined (type guard at the boundary).
 *
 * @param value anything
 */
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** One client object of an earlier version. */
interface LegacyClient {
  /** Its id without the namespace. */
  id: string;
  /** Its object. */
  obj: Partial<ioBroker.Object>;
  /** Its key. */
  key: string;
}

/**
 * Move every client object of an earlier version to its current id and forget every stored key whose object is gone.
 * Throws when the objects cannot be read or the file cannot be written — nothing old is deleted then.
 *
 * @param adapter the adapter
 * @param store the client keys, loaded
 * @param describeError the error-text helper
 * @returns what it did
 */
export async function moveClients(
  adapter: ClientMoveAdapter,
  store: ClientStore,
  describeError: (err: unknown) => string,
): Promise<ClientMoveResult> {
  const ns = adapter.namespace;
  // The states of a folder, read once with one call when a client of an earlier version needs them — keyed by full id,
  // and kept up to date with what the move writes.
  const states = new Map<string, Map<string, ioBroker.State | null | undefined>>();
  const statesOf = async (folder: string): Promise<Map<string, ioBroker.State | null | undefined>> => {
    let read = states.get(folder);
    if (!read) {
      read = new Map(Object.entries((await adapter.getStatesAsync(`${folder}.*`)) ?? {}));
      states.set(folder, read);
    }
    return read;
  };
  const stateOf = async (id: string): Promise<ioBroker.State | null | undefined> =>
    (await statesOf(id.slice(0, id.indexOf(".")))).get(`${ns}.${id}`);
  const legacy: LegacyClient[] = [];
  const present = new Set<string>();
  /** Every id below `clients.` — an old `clients.<key>` included, which the move is about to delete. */
  const taken = new Set<string>();
  let keyless = 0;

  // Before v1.2.0: `user.<key>` — its key in native.username, or as its value, or as its id.
  const userFolder = await adapter.getObjectAsync(LEGACY_USER_FOLDER);
  if (userFolder) {
    const prefix = `${ns}.${LEGACY_USER_FOLDER}.`;
    const users = await adapter.getObjectListAsync({ startkey: prefix, endkey: `${prefix}${ID_RANGE_END}` });
    for (const row of users?.rows ?? []) {
      const obj = (row.value ?? {}) as Partial<ioBroker.Object>;
      const id = row.id.slice(ns.length + 1);
      const value = (await stateOf(id))?.val;
      const key =
        text((obj.native as { username?: unknown } | undefined)?.username) ??
        text(value) ??
        row.id.slice(prefix.length);
      legacy.push({ id, obj, key });
    }
  }

  // Up to v1.19.0: `clients.<key>`, every one with native.username — each version wrote it (0.0.3 hue-handler.js,
  // v1.0.1 to v1.19.0 user-service.ts), and the move from `user.` in v1.2.0 carried it over. One without it is the
  // current form — with its key in the file, or without one (the file was lost): such an object can never sign in.
  const prefix = `${ns}.${CLIENTS_FOLDER}.`;
  const clients = await adapter.getObjectListAsync({ startkey: prefix, endkey: `${prefix}${ID_RANGE_END}` });
  for (const row of clients?.rows ?? []) {
    const obj = (row.value ?? {}) as Partial<ioBroker.Object>;
    const suffix = row.id.slice(prefix.length);
    if (obj.type !== "state" || !suffix || suffix.includes(".")) {
      continue;
    }
    taken.add(suffix);
    const stored = text((obj.native as { username?: unknown } | undefined)?.username);
    if (stored === undefined) {
      present.add(suffix);
      if (store.keyOf(suffix) === undefined) {
        keyless++;
      }
      continue;
    }
    legacy.push({ id: row.id.slice(ns.length + 1), obj, key: stored });
  }
  // No new id may be the id of an object that is still there — the move would delete its own successor, or a new
  // client would take over an object without a key.
  store.reserve(taken);

  const successors = new Map<string, string>();
  for (const client of legacy) {
    const legacyCommon = (client.obj.common ?? {}) as Partial<ioBroker.StateCommon>;
    const legacyName: unknown = legacyCommon.name;
    const devicetype = nameText(legacyName, UNKNOWN_DEVICETYPE);
    // The file first — a start that ends after this line finds the key and gives it the same id.
    const clientId = store.add(client.key, devicetype);
    present.add(clientId);
    const newId = `${CLIENTS_FOLDER}.${clientId}`;
    await adapter.setObjectNotExistsAsync(newId, {
      type: "state",
      // Everything that hangs on the datapoint goes with it; the shape is the current one. A translation object stays
      // as it is (a rename in the admin included); a bare name (before v1.15.1) becomes one through clientCommon.
      common: {
        ...legacyCommon,
        ...clientCommon(devicetype),
        ...(legacyName && typeof legacyName === "object" ? { name: legacyName as ioBroker.StringOrTranslated } : {}),
      },
      native: {},
    });
    const old = await stateOf(client.id);
    const now = await stateOf(newId);
    if (now?.val !== devicetype) {
      // The pairing time is the state's last change (audit R-07) — handed over, or every moved client would show the
      // move as its pairing.
      const lc = typeof old?.lc === "number" ? old.lc : typeof client.obj.ts === "number" ? client.obj.ts : undefined;
      const state = { val: devicetype, ack: true, ...(lc === undefined ? {} : { lc }) };
      await adapter.setState(newId, state);
      // A second old object with the same key (`user.<key>` and `clients.<key>`) finds the value already written.
      (await statesOf(CLIENTS_FOLDER)).set(`${ns}.${newId}`, {
        ...state,
        ts: Date.now(),
        lc: lc ?? Date.now(),
        from: "",
        q: 0,
      });
    }
    successors.set(`${ns}.${client.id}`, `${ns}.${newId}`);
  }

  if (successors.size > 0 || userFolder) {
    // The fleet order (enum-carry.ts): read the room and function assignments once, delete every old object (the old
    // folder last), write each enum once with all its new ids.
    await moveAllWithEnums(
      adapter,
      memberId => {
        const successor = successors.get(memberId);
        return successor ? [successor] : [];
      },
      async () => {
        for (const oldFullId of successors.keys()) {
          await adapter.delObjectAsync(oldFullId.slice(ns.length + 1));
        }
        if (userFolder) {
          await adapter.delObjectAsync(LEGACY_USER_FOLDER);
        }
      },
      describeError,
    );
  }
  if (successors.size > 0) {
    adapter.log.info(
      `Moved ${successors.size} paired client(s) to objects named after their device type — their keys are kept in ${CLIENTS_FILE} in the instance data folder`,
    );
  }

  // A key whose object was deleted while the adapter was stopped: that client is revoked. An unreadable file loaded as
  // an empty table, so nothing of it is forgotten here.
  const forgotten = store.keepOnly(present);
  if (forgotten > 0) {
    adapter.log.debug(`Forgot ${forgotten} client key(s) whose object was deleted`);
  }
  if (keyless > 0 && store.readable) {
    adapter.log.warn(
      `${keyless} paired client object(s) have no stored key in ${CLIENTS_FILE} and cannot sign in — pair the client again with the link button and delete its old object`,
    );
  }
  return { moved: successors.size, keyless, forgotten };
}
