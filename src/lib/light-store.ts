/**
 * The lights the bridge serves, kept as the adapter's own device objects — never in the instance's `native`.
 *
 * Audit R-24 (B02 `audit_own_native_at_runtime`, krobi 2026-11-05 22:46, CLAUDE_PATTERNS § "native belongs to the
 * user"): up to v1.19.0 the device manager wrote the light list into `native.devices`. The settings page writes back
 * the `native` it opened with — a light added in the device card while the settings were open was gone after "Save" —
 * and every such write restarted the instance.
 *
 * Form: `lights.<n>` is a `device` whose number `<n>` is the light's permanent Hue id (design decision 25), whose
 * `common.name` is the light's name and whose `native` holds the light's settings (type, bound datapoints, scales).
 * No datapoint hangs below it: a light only links datapoints of the same installation, a reachability datapoint would
 * say nothing (krobi 2026-11-11 14:27). The highest number ever handed out lives in `light-ids.json` in the instance data folder, so a deleted light's
 * number — and with it its `uniqueid`, which Alexa keys a device by — is never handed out again.
 *
 * Every change goes through one queue: two admin tabs adding lights at the same moment would otherwise both read the
 * same mark and hand out the same number.
 */

import type { DeviceConfig } from "../hue-api";
import { coveredBy } from "./known-objects";
import { readDataFile, writeDataFile } from "./data-file";
import { isDeviceId, nextDeviceId } from "./device-ids";
import { nameIn, tRaw } from "./i18n";
import { ID_RANGE_END } from "./migrations";

/** The folder of the light devices (an `instanceObjects` entry of the manifest). */
export const LIGHTS_FOLDER = "lights";
/** The file in the instance data folder that holds the highest light number ever handed out. */
export const LIGHT_IDS_FILE = "light-ids.json";

/** The adapter methods the store needs — an `ioBroker.Adapter` carries all of them. */
export interface LightStoreAdapter {
  /** e.g. "hueemu.0" */
  namespace: string;
  /** The system language (`useFormatDate`) — the language a light's name is read in. */
  language?: ioBroker.Languages;
  /** Reads the objects between two ids. */
  getObjectListAsync(params: {
    startkey: string;
    endkey: string;
  }): Promise<{ rows: Array<{ id: string; value: unknown }> } | null | undefined>;
  /** Reads one object. */
  getForeignObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
  /** Replaces (or creates) an object completely. */
  setForeignObject(id: string, obj: ioBroker.SettableObject): Promise<unknown>;
  /** Merges into an object. */
  extendForeignObjectAsync(id: string, obj: ioBroker.PartialObject): Promise<unknown>;
  /** Deletes an object, with `recursive` its children too. */
  delForeignObjectAsync(id: string, options?: { recursive?: boolean }): Promise<unknown>;
}

/** What the store holds right now. */
export interface StoredLights {
  /** The lights, by number, each with its number as `id` and its object name as `name`. */
  lights: DeviceConfig[];
  /** Every object below `lights.` (full id → object), as read. */
  objects: Map<string, unknown>;
}

/** The result of reading the mark: the number (0 when there is none) and why the file is unusable, if it is. */
export interface MarkRead {
  /** The highest light number ever handed out, 0 when unknown. */
  mark: number;
  /** Set when the file exists but cannot be used. */
  error?: string;
}

/**
 * A light's settings as its object's `native` holds them — everything but the number (the object id) and the name
 * (`common.name`).
 *
 * @param config the light
 */
export function settingsOf(config: DeviceConfig): Record<string, unknown> {
  const { id: _id, name: _name, ...settings } = config;
  return settings;
}

/** The light object ids of an instance. */
export class LightIds {
  private readonly prefix: string;
  private readonly pattern: RegExp;

  /** @param namespace e.g. "hueemu.0" */
  public constructor(namespace: string) {
    this.prefix = `${namespace}.${LIGHTS_FOLDER}.`;
    this.pattern = new RegExp(`^${this.prefix.replace(/\./g, "\\.")}(\\d+)$`);
  }

  /**
   * The full id of a light's device object.
   *
   * @param n the light number
   */
  public device(n: number): string {
    return `${this.prefix}${n}`;
  }

  /**
   * The light number of a device object id; undefined for every other id (a datapoint below it included).
   *
   * @param id a full object id
   */
  public numberOf(id: string): number | undefined {
    const m = this.pattern.exec(id);
    const n = m ? Number(m[1]) : undefined;
    return isDeviceId(n) ? n : undefined;
  }

  /** The id range of everything below the folder, for one object-list read. */
  public range(): { startkey: string; endkey: string } {
    return { startkey: this.prefix, endkey: `${this.prefix}${ID_RANGE_END}` };
  }
}

/**
 * The device object of a new light.
 *
 * @param light the light, numbered
 * @param icon the pictogram (device-icons.ts), undefined when its file cannot be read
 */
export function lightObject(light: DeviceConfig & { id: number }, icon: string | undefined): ioBroker.SettableObject {
  return {
    type: "device",
    common: {
      name: tRaw(light.name),
      ...(icon ? { icon } : {}),
    },
    native: settingsOf(light),
  };
}

/**
 * What every light's device object carries besides the user's name and settings — merged in at start, so a light an
 * earlier version or a hand created gets it too.
 *
 * @param icon the pictogram, undefined when its file cannot be read (the stored one then stays)
 */
export function lightCommonPatch(icon: string | undefined): ioBroker.PartialObject {
  return { common: icon ? { icon } : {} };
}

/** The lights as device objects, the mark as a file. */
export class LightStore {
  private readonly adapter: LightStoreAdapter;
  private readonly dir: string;
  /** The pictogram every light's device object carries (device-icons.ts) — an input, so a test hands in its own. */
  private readonly icon: string | undefined;
  /** The light object ids of this instance. */
  public readonly ids: LightIds;
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param adapter the adapter
   * @param dir the instance data folder
   * @param icon the pictogram, undefined when its file cannot be read (a stored one then stays)
   */
  public constructor(adapter: LightStoreAdapter, dir: string, icon: string | undefined) {
    this.adapter = adapter;
    this.dir = dir;
    this.icon = icon;
    this.ids = new LightIds(adapter.namespace);
  }

  /**
   * Runs one change after every change before it, whatever became of that one.
   *
   * @param run the change
   */
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Every light and every object below the folder, with one read. */
  public async list(): Promise<StoredLights> {
    const result = await this.adapter.getObjectListAsync(this.ids.range());
    const objects = new Map<string, unknown>();
    const lights: DeviceConfig[] = [];
    for (const row of result?.rows ?? []) {
      if (!row.value) {
        continue;
      }
      objects.set(row.id, row.value);
      const n = this.ids.numberOf(row.id);
      const obj = row.value as Partial<ioBroker.Object>;
      if (n === undefined || obj.type !== "device") {
        continue;
      }
      // Type guard at the boundary: a hand-edited object can carry anything in native.
      const native =
        typeof obj.native === "object" && obj.native !== null && !Array.isArray(obj.native) ? obj.native : {};
      lights.push({
        ...(native as Partial<DeviceConfig>),
        id: n,
        name: nameIn(obj.common?.name, this.adapter.language),
      } as DeviceConfig);
    }
    lights.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    return { lights, objects };
  }

  /** The highest light number ever handed out. */
  public readMark(): MarkRead {
    const read = readDataFile(this.dir, LIGHT_IDS_FILE);
    const data = (typeof read.value === "object" && read.value !== null ? read.value : {}) as Record<string, unknown>;
    const mark = isDeviceId(data.lastLightId) ? data.lastLightId : 0;
    return read.error === undefined ? { mark } : { mark, error: read.error };
  }

  /**
   * Store the highest light number ever handed out. Throws when the file cannot be written.
   *
   * @param mark the number
   */
  public writeMark(mark: number): void {
    writeDataFile(this.dir, LIGHT_IDS_FILE, { lastLightId: mark });
  }

  /**
   * Raise the mark to the numbers seen — a light deleted in the object browser keeps its number taken as well.
   * Throws when the file cannot be written.
   *
   * @param numbers the light numbers in use
   * @returns whether the mark rose
   */
  public raiseMark(numbers: readonly number[]): boolean {
    const { mark } = this.readMark();
    const top = Math.max(mark, ...numbers);
    if (top <= mark) {
      return false;
    }
    this.writeMark(top);
    return true;
  }

  /**
   * Create a numbered light's device object.
   *
   * @param light the light, carrying its number
   */
  public async create(light: DeviceConfig & { id: number }): Promise<void> {
    await this.adapter.setForeignObject(this.ids.device(light.id), lightObject(light, this.icon));
  }

  /**
   * Add lights: each gets the next number above every number in use and ever handed out. The mark is stored FIRST —
   * when it cannot be, no light is created (a number not recorded could be handed out again).
   *
   * @param configs the lights, without numbers
   * @returns the lights as stored, numbered
   */
  public add(configs: DeviceConfig[]): Promise<Array<DeviceConfig & { id: number }>> {
    return this.serial(async () => {
      const { lights } = await this.list();
      let next = nextDeviceId(lights, this.readMark().mark);
      const added = configs.map(config => ({ ...config, id: next++ }));
      if (added.length === 0) {
        return added;
      }
      this.writeMark(next - 1);
      for (const light of added) {
        await this.create(light);
      }
      return added;
    });
  }

  /**
   * Save an edited light: its device object is read fresh and written back whole with the new name and settings — a
   * merge would keep a setting the edit removed (a colour datapoint after switching to on/off). Everything else the
   * object carries stays: the pictogram, a name translated by hand when the text did not change.
   *
   * @param light the light, carrying its number
   * @returns false when the light is gone
   */
  public save(light: DeviceConfig & { id: number }): Promise<boolean> {
    return this.serial(async () => {
      const id = this.ids.device(light.id);
      const stored = await this.adapter.getForeignObjectAsync(id);
      if (stored?.type !== "device") {
        return false;
      }
      const name =
        nameIn(stored.common?.name, this.adapter.language) === light.name ? stored.common.name : tRaw(light.name);
      await this.adapter.setForeignObject(id, {
        ...stored,
        common: { ...stored.common, name },
        native: settingsOf(light),
      });
      return true;
    });
  }

  /**
   * Delete a light with everything below it. Its number stays taken: the mark covers it first, and when the mark
   * cannot be stored nothing is deleted.
   *
   * @param n the light number
   */
  public remove(n: number): Promise<void> {
    return this.serial(async () => {
      this.raiseMark([n]);
      await this.adapter.delForeignObjectAsync(this.ids.device(n), { recursive: true });
    });
  }

  /**
   * Bring every light's device object to the current form, writing only what differs: the pictogram (the user's name
   * and settings stay).
   *
   * @param stored what {@link list} read
   * @returns how many objects were written
   */
  public reconcile(stored: StoredLights): Promise<number> {
    return this.serial(async () => {
      let written = 0;
      const patch = lightCommonPatch(this.icon);
      for (const light of stored.lights) {
        const id = this.ids.device(light.id ?? 0);
        if (!coveredBy(patch, stored.objects.get(id))) {
          await this.adapter.extendForeignObjectAsync(id, patch);
          written++;
        }
      }
      return written;
    });
  }
}
