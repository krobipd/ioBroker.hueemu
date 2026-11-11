/**
 * Guard K15 — a light stands in the object tree under its number (`lights.1`, `lights.2` …); its name is the name the
 * user gives it on the card and follows every rename there.
 *
 * The register, K15: "A light stands in the object tree under its number (lights.1, lights.2 …). Its name is the name
 * the user gives it on the card, and it follows every rename there."
 * krobi 2026-11-11 15:15, on the questions "Do you mean the explanatory sentence or the id in the path by
 * 'description'?" and "Shall a light's id be formed from its name (lights.wohnzimmer-licht) instead of its number
 * (lights.1)?": "the id may well be lights.1 and so on, but the description shall carry the name I give, and be updated
 * too" — meant is the name the object list shows (`common.name`). Accepted by krobi with the page of hueemu's datapoint
 * tree (Ressourcen/hueemu/baum-2026-11-11e.html) on 2026-11-11 16:59 ("yes").
 *
 * Path: the device manager behind the "Devices" tab (device-management.ts — its registered add and edit handlers,
 * dm-utils as installed) over the light store, an object database in memory and a data folder in the system's
 * temporary folder.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }), translate: (key: string) => key },
}));

import { HueEmuDeviceManagement } from "../device-management";
import { LightStore, type LightStoreAdapter } from "../lib/light-store";

/** The form the card shows, answered with what the user typed. */
interface Card {
  showForm: (schema: unknown, options: unknown) => Promise<Record<string, unknown> | undefined>;
  showMessage: () => Promise<void>;
  showConfirmation: () => Promise<boolean>;
}

/** A card action as the device manager registers it. */
interface CardAction {
  id: string;
  handler: (...args: unknown[]) => Promise<unknown>;
}

/** The handlers dm-utils calls — the add action above the list, the actions of each light's card. */
interface Registered {
  getInstanceInfo(): { actions: CardAction[] };
  loadDevices(context: { addDevice(card: { id: string; actions: CardAction[] }): void }): Promise<void>;
}

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

/**
 * The device manager over an object database in memory with the calls it and the light store make.
 *
 * @param objects where the objects land
 */
function manager(objects: Map<string, ioBroker.Object>): Registered {
  const noop = (): void => undefined;
  const adapter: LightStoreAdapter & Record<string, unknown> = {
    namespace: "hueemu.0",
    language: "en",
    log: { silly: noop, debug: noop, info: noop, warn: noop, error: noop },
    on: noop,
    getObjectListAsync({ startkey, endkey }) {
      const rows = [...objects]
        .filter(([id]) => id >= startkey && id <= endkey)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, value]) => ({ id, value: structuredClone(value) }));
      return Promise.resolve({ rows });
    },
    getForeignObjectAsync: id => Promise.resolve(structuredClone(objects.get(id) ?? null)),
    setForeignObject(id, obj) {
      objects.set(id, { ...structuredClone(obj), _id: id } as ioBroker.Object);
      return Promise.resolve({ id });
    },
    extendForeignObjectAsync(id, obj) {
      objects.set(id, { ...(objects.get(id) ?? {}), ...structuredClone(obj), _id: id } as ioBroker.Object);
      return Promise.resolve({ id });
    },
    delForeignObjectAsync(id) {
      objects.delete(id);
      return Promise.resolve();
    },
  };
  const folder = mkdtempSync(join(tmpdir(), "hueemu-guard-k15-"));
  folders.push(folder);
  const store = new LightStore(adapter, folder, undefined);
  const dm = new HueEmuDeviceManagement(
    adapter as unknown as ConstructorParameters<typeof HueEmuDeviceManagement>[0],
    store,
  );
  return dm as unknown as Registered;
}

/**
 * The card's form, answered with a light the user typed.
 *
 * @param name the name typed into the form
 */
function card(name: string): Card {
  return {
    showForm: () => Promise.resolve({ name, lightType: "onoff", onState: "javascript.0.lamp" }),
    showMessage: () => Promise.resolve(),
    showConfirmation: () => Promise.resolve(true),
  };
}

/**
 * Add a light through the add action above the list.
 *
 * @param dm the device manager
 * @param name the name typed into the form
 */
async function addOnCard(dm: Registered, name: string): Promise<void> {
  const add = dm.getInstanceInfo().actions.find(action => action.id === "add");
  await add?.handler(card(name));
}

/**
 * Rename a light through the edit action of its card.
 *
 * @param dm the device manager
 * @param n the light's number — its card id
 * @param name the new name typed into the form
 */
async function renameOnCard(dm: Registered, n: number, name: string): Promise<void> {
  const cards: Array<{ id: string; actions: CardAction[] }> = [];
  await dm.loadDevices({ addDevice: shown => cards.push(shown) });
  const edit = cards.find(shown => shown.id === String(n))?.actions.find(action => action.id === "edit");
  await edit?.handler(String(n), card(name));
}

/**
 * Every text a light's object carries as its name — one, in whatever languages it is stored.
 *
 * @param objects the object database
 * @param id the light's full id
 */
function namesOf(objects: Map<string, ioBroker.Object>, id: string): string[] {
  const name = objects.get(id)?.common?.name;
  return typeof name === "string" ? [name] : [...new Set(Object.values(name ?? {}))];
}

describe("K15: a light stands under its number and carries the user's name from the card", () => {
  it("creates the device objects lights.1 and lights.2", async () => {
    const objects = new Map<string, ioBroker.Object>();
    const dm = manager(objects);
    await addOnCard(dm, "Lamp");
    await addOnCard(dm, "Lamp");
    const devices = [...objects.values()].filter(obj => obj.type === "device").map(obj => obj._id);

    expect(devices.sort()).toEqual(["hueemu.0.lights.1", "hueemu.0.lights.2"]);
  });

  it("names the light as the user names it on the card and follows every rename there", async () => {
    const objects = new Map<string, ioBroker.Object>();
    const dm = manager(objects);
    await addOnCard(dm, "Living room - Light");
    const added = namesOf(objects, "hueemu.0.lights.1");
    await renameOnCard(dm, 1, "Living room - Ceiling");
    const renamed = namesOf(objects, "hueemu.0.lights.1");
    await renameOnCard(dm, 1, "Dining room - Light");
    const renamedAgain = namesOf(objects, "hueemu.0.lights.1");

    expect({ added, renamed, renamedAgain }).toEqual({
      added: ["Living room - Light"],
      renamed: ["Living room - Ceiling"],
      renamedAgain: ["Dining room - Light"],
    });
  });
});
