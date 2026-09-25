/**
 * v1.11.0: ioBroker Device-Manager backend for the hueemu devices tab.
 *
 * Replaces the jsonConfig accordion with the sanctioned device-manager UI so
 * that manual add/edit/delete and an "assistant" (scan for lights via
 * `@iobroker/type-detector`) live side by side in ONE tab. The device list is
 * the adapter's own `native.devices` config array — unchanged in shape and still
 * the only thing the runtime reads. Every mutating action writes `native.devices`
 * back, which restarts the adapter (like a jsonConfig save) so the new mappings
 * take effect; the manager reloads the list afterwards.
 *
 * The edit/add form reuses the exact same fields as the old accordion (object
 * pickers, light type, scales), rendered natively by admin. All user-facing
 * text (form labels, action titles, confirmations, messages) is resolved to a
 * full 11-language translation object via `t()` so it renders correctly in every
 * admin language regardless of how the device-manager frontend resolves strings.
 */

import {
  DeviceManagement,
  type DeviceInfo,
  type DeviceLoadContext,
  type ActionContext,
  type JsonFormSchema,
} from "@iobroker/dm-utils";
import type { DeviceConfig } from "./hue-api";
import { isDeviceId, lightIdHighWater, nextDeviceId, normalizeDevices } from "./lib/device-ids";
import { boundStateIds, scanForLightDevices } from "./lib/device-scan";
import { t } from "./lib/i18n";
import { errText } from "./types/utils";

/** Manager directive returned by an instance action — reload the whole view. */
type InstanceResult = { refresh: boolean };
/** Manager directive returned by a per-device action — reload the device list. */
type DeviceResult = { refresh: "instance" };
/** What the device manager reads before a change: the list and the highest number ever handed out. */
type DeviceStore = { devices: DeviceConfig[]; lastLightId: number };

/**
 * Which DeviceConfig fields are relevant per light type — used to prune the form
 * result. The light's permanent number (`id`) is deliberately NOT a form field:
 * it comes from the stored entry (edit) or is assigned by the backend (add), never
 * from the user.
 */
const FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  onoff: ["name", "lightType", "onState"],
  dimmable: ["name", "lightType", "onState", "briState", "briScale"],
  ct: ["name", "lightType", "onState", "briState", "briScale", "ctState", "ctScale"],
  color: [
    "name",
    "lightType",
    "onState",
    "briState",
    "briScale",
    "ctState",
    "ctScale",
    "hueState",
    "hueScale",
    "satState",
    "satScale",
    "xyState",
  ],
};

/**
 * Build the per-device edit form. Mirrors the admin/jsonConfig.json device
 * fields; every label/tooltip/option is a resolved translation object so the
 * embedded form is language-correct without depending on the frontend's i18n
 * namespace. Built at call time (not module load) because `t()` needs
 * `I18n.init()`, which has run by the time a device-manager action fires.
 *
 * @returns The jsonConfig panel schema describing one light.
 */
export function buildDeviceForm(): JsonFormSchema {
  return {
    type: "panel",
    items: {
      name: { type: "text", label: t("deviceName"), default: "New Light", sm: 12, md: 6 },
      lightType: {
        type: "select",
        label: t("lightType"),
        default: "dimmable",
        options: [
          { label: t("lightTypeOnOff"), value: "onoff" },
          { label: t("lightTypeDimmable"), value: "dimmable" },
          { label: t("lightTypeCT"), value: "ct" },
          { label: t("lightTypeColor"), value: "color" },
        ],
        sm: 12,
        md: 6,
      },
      onState: { type: "objectId", label: t("stateOn"), tooltip: t("stateOnTooltip"), sm: 12, md: 6 },
      briState: {
        type: "objectId",
        label: t("stateBri"),
        tooltip: t("stateBriTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType === 'onoff'",
      },
      briScale: {
        type: "select",
        label: t("scaleBri"),
        tooltip: t("scaleTooltip"),
        // No preselection: an empty scale means "derive it from the bound
        // datapoint". Until v1.16.0 this select preselected `auto`, which the
        // form stored as a decision — and a stored decision is never derived and
        // never backfilled, so a hand-added percent dimmer stayed on the legacy
        // heuristic for good (audit 2026-09-06 F1).
        default: "",
        options: [
          { label: t("scaleAuto"), value: "" },
          { label: t("scalePercent"), value: "percent" },
          { label: t("scaleNormalized"), value: "normalized" },
          { label: t("scaleRaw"), value: "raw" },
          { label: t("scaleByte"), value: "byte" },
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType === 'onoff'",
      },
      ctState: {
        type: "objectId",
        label: t("stateCt"),
        tooltip: t("stateCtTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'ct' && data.lightType !== 'color'",
      },
      ctScale: {
        type: "select",
        label: t("scaleCt"),
        tooltip: t("scaleCtTooltip"),
        default: "",
        options: [
          { label: t("scaleAuto"), value: "" },
          { label: t("scaleNative"), value: "raw" },
          { label: t("scaleKelvin"), value: "kelvin" },
          { label: t("scaleCtPercent"), value: "percent" },
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'ct' && data.lightType !== 'color'",
      },
      hueState: {
        type: "objectId",
        label: t("stateHue"),
        tooltip: t("stateHueTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'color'",
      },
      hueScale: {
        type: "select",
        label: t("scaleHue"),
        tooltip: t("scaleHueTooltip"),
        default: "",
        options: [
          { label: t("scaleAuto"), value: "" },
          { label: t("scaleNative"), value: "raw" },
          { label: t("scaleDegrees"), value: "degrees" },
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'color'",
      },
      satState: {
        type: "objectId",
        label: t("stateSat"),
        tooltip: t("stateSatTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'color'",
      },
      satScale: {
        type: "select",
        label: t("scaleSat"),
        tooltip: t("scaleTooltip"),
        default: "",
        options: [
          { label: t("scaleAuto"), value: "" },
          { label: t("scalePercent"), value: "percent" },
          { label: t("scaleNormalized"), value: "normalized" },
          { label: t("scaleRaw"), value: "raw" },
          { label: t("scaleByte"), value: "byte" },
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'color'",
      },
      xyState: {
        type: "objectId",
        label: t("stateXy"),
        tooltip: t("stateXyTooltip"),
        sm: 12,
        md: 6,
        hidden: "data.lightType !== 'color'",
      },
    },
  };
}

/**
 * Turn raw form data into a clean DeviceConfig: drop empty pickers, the
 * undecided value scales, and any field not relevant to the chosen light type
 * (e.g. a stale hueState left over when a colour light is switched to on/off),
 * so `native.devices` stays tidy.
 *
 * @param raw The submitted form values.
 * @returns The pruned device mapping.
 */
export function cleanDevice(raw: Record<string, unknown>): DeviceConfig {
  const type = typeof raw.lightType === "string" ? raw.lightType : "";
  const allowed = FIELDS_BY_TYPE[type];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "" || value === undefined || value === null) {
      continue;
    }
    // "auto" is the pre-v1.17.0 spelling of "no scale decided". Storing it kept
    // the light out of the derivation for good, so an edit drops it and the
    // scale is derived from the bound datapoint again.
    if (key.endsWith("Scale") && value === "auto") {
      continue;
    }
    if (allowed && !allowed.includes(key)) {
      continue;
    }
    out[key] = value;
  }
  return out as unknown as DeviceConfig;
}

/**
 * Build the "which lights to add" form: one checkbox per freshly detected light,
 * labelled with its name, detected Hue type and mapped on/off state so that
 * near-identical devices stay distinguishable. All unticked by default — the
 * user opts in per light, so a system with 30 lights never dumps all 30 into
 * the bridge.
 *
 * @param devices The freshly detected, not-yet-mapped light suggestions.
 * @returns A jsonConfig panel with one checkbox per device.
 */
export function buildSelectionForm(devices: DeviceConfig[]): JsonFormSchema {
  const items: Record<string, unknown> = {
    _hint: { type: "staticText", text: t("dmSelectHint"), sm: 12 },
  };
  devices.forEach((device, index) => {
    const suffix = device.onState ? ` · ${device.onState}` : "";
    items[`sel_${index}`] = {
      type: "checkbox",
      label: `${device.name} · ${device.lightType}${suffix}`,
      default: false,
      sm: 12,
    };
  });
  return { type: "panel", items } as unknown as JsonFormSchema;
}

/**
 * ioBroker device-manager backend: exposes `native.devices` as device cards with
 * add/edit/delete actions plus a "search lights" assistant. Owns no state of its
 * own — it reads and writes the adapter's config object.
 */
export class HueEmuDeviceManagement extends DeviceManagement {
  /** The `system.adapter.*` object id whose `native.devices` holds the mapping list. */
  private get objId(): string {
    return `system.adapter.${this.adapter.namespace}`;
  }

  /**
   * Read the device list and the highest light number ever handed out, fresh
   * from the live config object (so it reflects a write that is still
   * triggering a restart).
   *
   * @returns The configured devices (an empty list if none) and `lastLightId` (0 if unknown).
   */
  private async readStore(): Promise<DeviceStore> {
    const obj = await this.adapter.getForeignObjectAsync(this.objId);
    const native = obj?.native as { devices?: unknown; lastLightId?: unknown } | undefined;
    return {
      devices: normalizeDevices(native?.devices),
      lastLightId: isDeviceId(native?.lastLightId) ? native.lastLightId : 0,
    };
  }

  /**
   * Read the device list only.
   *
   * @returns The configured devices, or an empty list if none.
   */
  private async readDevices(): Promise<DeviceConfig[]> {
    return (await this.readStore()).devices;
  }

  /**
   * Persist the device list together with the highest light number ever handed
   * out (v1.19.0, audit 2026-09-25 K3) — the mark covers the list before AND
   * after the change, so the number of a light deleted right now stays taken.
   * Writing `native.*` restarts the adapter, which re-binds the lights with the
   * new mappings.
   *
   * @param devices The full device list to store.
   * @param before The store this change started from.
   */
  private async writeDevices(devices: DeviceConfig[], before: DeviceStore): Promise<void> {
    const lastLightId = lightIdHighWater(before.lastLightId, before.devices, devices);
    await this.adapter.extendForeignObjectAsync(this.objId, { native: { devices, lastLightId } });
  }

  /**
   * Run one device-manager action so that it can never reject.
   *
   * dm-utils calls our handlers from `handleMessage`, whose only safety net is
   * `void this.handleMessage(obj).catch(this.log.error)` — so a rejection does not
   * crash the adapter, but it aborts `handleMessage` at the throw. The reply that
   * closes the action (`context.sendFinalResult`) is then never sent and the
   * `messageContexts` entry for that request is never removed (dm-utils 3.2.0
   * deletes it only on the normal path and has no timeout of its own). The user
   * would be left with nothing but a log line.
   *
   * So every handler answers, always: on failure we log, tell the user what went
   * wrong, and return the same directive the successful path returns — the manager
   * simply reloads. This is the rule `searchDevices` already followed on its own.
   *
   * @param context The action context used to reach the user.
   * @param fallback The directive to return when the action failed.
   * @param run The actual action.
   * @returns The action's result, or `fallback` when it threw.
   */
  private async guardAction<T>(context: ActionContext, fallback: T, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      const reason = errText(e);
      this.adapter.log.warn(`Device-manager action failed: ${reason}`);
      try {
        await context.showMessage(t("dmActionFailed", reason));
      } catch (notifyError) {
        // Telling the user failed too — nothing left to do but say so in the log.
        this.adapter.log.debug(`Could not report the failure to the user: ${errText(notifyError)}`);
      }
      return fallback;
    }
  }

  /**
   * Populate the device-manager list from `native.devices`.
   *
   * Reading the config object can fail (objects DB unreachable). This path has no
   * `ActionContext` — `DeviceLoadContext` only offers `addDevice`/`setTotalDevices`
   * — and it does not go through `sendFinalResult` either: dm-utils handles
   * `dm:loadDevices` separately and, on a throw, skips both the context cleanup and
   * the rebuild of its device map. Catching here keeps that path intact; the user
   * sees an empty list plus a warning instead of a view that never finishes.
   *
   * @param context The load context to add one card per device to.
   */
  protected async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
    try {
      const devices = await this.readDevices();
      devices.forEach((device, index) => context.addDevice(this.toDeviceInfo(device, index)));
    } catch (e) {
      this.adapter.log.warn(`Could not read the configured lights: ${errText(e)}`);
    }
  }

  /**
   * The stable card id of a device: its permanent light number.
   *
   * v1.17.0 keyed the card by the driving state id instead of the array position,
   * so a list that shifted between rendering and acting no longer pointed the
   * action at a different light (audit 2026-09-06 F10). v1.18.0: two lights on
   * the same source shared that key — deleting the second card removed the first
   * (audit 2026-09-15 A2). The number is unique by construction; the position is
   * only the fallback for an entry the start-up migration has not numbered yet.
   *
   * @param device The stored mapping.
   * @param index Its position in the list.
   * @returns A card id that survives a shift of the list.
   */
  private static cardId(device: DeviceConfig, index: number): string {
    return isDeviceId(device.id) ? String(device.id) : `#${index}`;
  }

  /**
   * Resolve a card id back to a position in the CURRENT list.
   *
   * @param devices The list as it is right now.
   * @param cardId The id the card was built with.
   * @returns the position, or -1 when the device is gone.
   */
  private static indexOfCard(devices: DeviceConfig[], cardId: string): number {
    const byNumber = devices.findIndex((d, i) => HueEmuDeviceManagement.cardId(d, i) === cardId);
    if (byNumber >= 0) {
      return byNumber;
    }
    // A positional fallback id (`#3`) from a not yet numbered entry.
    const positional = /^#(\d+)$/.exec(cardId);
    return positional ? Number(positional[1]) : -1;
  }

  /**
   * Build one device card with edit/delete actions.
   *
   * @param device The stored mapping.
   * @param index Its position in the list.
   * @returns The device-manager card descriptor.
   */
  private toDeviceInfo(device: DeviceConfig, index: number): DeviceInfo<string> {
    return {
      id: HueEmuDeviceManagement.cardId(device, index),
      name: device.name || t("lightNameFallback", isDeviceId(device.id) ? device.id : index + 1),
      actions: [
        {
          id: "edit",
          icon: "edit",
          description: t("dmEdit"),
          handler: async (id: string, context: ActionContext) =>
            this.guardAction<DeviceResult>(context, { refresh: "instance" }, () => this.editDevice(id, context)),
        },
        {
          id: "delete",
          icon: "delete",
          description: t("dmDelete"),
          handler: async (id: string, context: ActionContext) =>
            this.guardAction<DeviceResult>(context, { refresh: "instance" }, () => this.deleteDevice(id, context)),
        },
      ],
    };
  }

  /**
   * Instance-level actions shown above the device list: manual add + the search
   * assistant.
   *
   * @returns The instance action descriptor.
   */
  protected getInstanceInfo(): ReturnType<DeviceManagement["getInstanceInfo"]> {
    return {
      apiVersion: "v3",
      actions: [
        {
          id: "add",
          icon: "add",
          title: t("dmAddLight"),
          handler: async context =>
            this.guardAction<InstanceResult>(context, { refresh: true }, () => this.addDevice(context)),
        },
        {
          id: "search",
          icon: "search",
          title: t("dmSearchLights"),
          handler: async context =>
            this.guardAction<InstanceResult>(context, { refresh: true }, () => this.searchDevices(context)),
        },
      ],
    };
  }

  /**
   * Manual add: show the empty form and append a valid result.
   *
   * @param context The action context.
   * @returns A directive to reload the manager.
   */
  private async addDevice(context: ActionContext): Promise<InstanceResult> {
    const data = await context.showForm(buildDeviceForm(), {
      title: t("dmAddLight"),
      data: { lightType: "dimmable" },
    });
    if (data && typeof data.name === "string" && data.name) {
      const store = await this.readStore();
      const devices = [...store.devices, { ...cleanDevice(data), id: nextDeviceId(store.devices, store.lastLightId) }];
      await this.writeDevices(devices, store);
    }
    return { refresh: true };
  }

  /**
   * Edit a device via the form, replacing it in place.
   *
   * @param cardId The card id the action was raised on.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async editDevice(cardId: string, context: ActionContext): Promise<DeviceResult> {
    const store = await this.readStore();
    const devices = [...store.devices];
    const index = HueEmuDeviceManagement.indexOfCard(devices, cardId);
    const current = devices[index];
    if (!current) {
      return { refresh: "instance" };
    }
    const data = await context.showForm(buildDeviceForm(), {
      title: t("dmEditTitle"),
      data: { ...current },
    });
    if (data && typeof data.name === "string" && data.name) {
      // The number is the light's identity for every paired client — it stays
      // with the entry, whatever the form sent back.
      devices[index] = { ...cleanDevice(data), id: current.id };
      await this.writeDevices(devices, store);
    }
    return { refresh: "instance" };
  }

  /**
   * Delete a device after confirmation.
   *
   * @param cardId The card id the action was raised on.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async deleteDevice(cardId: string, context: ActionContext): Promise<DeviceResult> {
    const store = await this.readStore();
    const devices = [...store.devices];
    const index = HueEmuDeviceManagement.indexOfCard(devices, cardId);
    const target = devices[index];
    if (!target) {
      return { refresh: "instance" };
    }
    const confirmed = await context.showConfirmation(t("dmDeleteConfirm", target.name || ""));
    if (confirmed) {
      devices.splice(index, 1);
      await this.writeDevices(devices, store);
    }
    return { refresh: "instance" };
  }

  /**
   * Assistant: scan the object tree for light devices and append the ones that
   * are not mapped yet. hueemu's own namespace is excluded (its emulated lights
   * would otherwise be re-detected as sources), and the append is keyed by the
   * mapped on/off state id so an existing entry is never overwritten — manual
   * edits and repeated scans stay non-destructive.
   *
   * @param context The action context.
   * @returns A directive to reload the manager.
   */
  private async searchDevices(context: ActionContext): Promise<InstanceResult> {
    const progress = await context.openProgress(t("dmSearching"), { indeterminate: true });
    let progressClosed = false;
    const closeProgress = async (): Promise<void> => {
      if (!progressClosed) {
        progressClosed = true;
        await progress.close();
      }
    };
    try {
      const objects = await this.loadAllObjects();
      const { devices: found, unmapped } = scanForLightDevices(objects, (id, obj) =>
        HueEmuDeviceManagement.displayName(obj.common?.name, id, this.adapter.language),
      );

      const store = await this.readStore();
      const existing = store.devices;
      // Append-only dedup over EVERY bound state: a light that shares any source
      // with a configured one is already in the bridge. v1.18.0: the check used
      // to look at the on/off state only, so a light without one (a dimmer with
      // nothing but a level) was offered — and stored — again on every scan
      // (audit 2026-09-15 A1).
      const mappedIds = new Set(existing.flatMap(boundStateIds));
      const fresh = found.filter(d => !boundStateIds(d).some(id => mappedIds.has(id)));
      await closeProgress();

      if (!fresh.length) {
        await context.showMessage(unmapped.length ? t("dmScanNoneSkipped", unmapped.length) : t("dmScanNone"));
        return { refresh: true };
      }

      // Let the user pick which detected lights to add — pre-unticked, so nothing
      // lands in the bridge by accident (30 detected lights ≠ 30 wanted Hue slots).
      const selection = await context.showForm(buildSelectionForm(fresh), { title: t("dmSelectTitle"), data: {} });
      if (selection) {
        const chosen = fresh.filter((_, index) => selection[`sel_${index}`] === true);
        // v1.19.0: the message goes out BEFORE the write — the write restarts the
        // instance at once, and a message the user confirms after that restart
        // reaches a process that no longer knows the request ("Unknown message
        // origin" in dm-utils 3.2.x, and the refresh never arrives; audit
        // 2026-09-25 H13). Add, edit and delete already answer before theirs.
        await context.showMessage(
          unmapped.length ? t("dmScanAddedSkipped", chosen.length, unmapped.length) : t("dmScanAdded", chosen.length),
        );
        if (chosen.length) {
          let next = nextDeviceId(existing, store.lastLightId);
          await this.writeDevices([...existing, ...chosen.map(device => ({ ...device, id: next++ }))], store);
        }
      }
    } catch (e) {
      await closeProgress();
      await context.showMessage(t("dmScanFailed", errText(e)));
    }
    return { refresh: true };
  }

  /**
   * The name a detected light is offered under: the object's `common.name` in the
   * system language, its English text, or — when the object carries no usable
   * name — its id.
   *
   * v1.18.0: `common.name` is a translation object on more and more adapters
   * (the core team's rule for every object type), and a translation object used
   * to fall through to the id — Alexa then learned "shelly.0.lamp" as the lamp's
   * name (audit 2026-09-15 A3).
   *
   * @param name The object's `common.name`.
   * @param id The object id, the last resort.
   * @param language The system language (`this.language`, present with `useFormatDate`).
   */
  private static displayName(name: unknown, id: string, language: string | undefined): string {
    if (typeof name === "string" && name) {
      return name;
    }
    if (name && typeof name === "object") {
      const translated = name as Record<string, unknown>;
      const candidates = [language && translated[language], translated.en];
      const hit = candidates.find(text => typeof text === "string" && text);
      if (typeof hit === "string") {
        return hit;
      }
    }
    return id;
  }

  /**
   * Load every object the type-detector needs — device + channel + state — from
   * the whole system, minus hueemu's own namespace.
   *
   * `getForeignObjectsAsync("*")` without a type argument defaults to the
   * js-controller 'state' object view (`getObjectView('system', type || 'state')`,
   * verified in js-controller v7.2.2), so it returns ONLY states and NEVER the
   * device/channel containers the detector keys off — which made every scan come
   * up empty. Fetching each type explicitly via getObjectView (govee pattern)
   * hands the detector the full tree.
   *
   * @returns Map of object id → object for all foreign device/channel/state objects.
   */
  private async loadAllObjects(): Promise<Record<string, ioBroker.Object>> {
    const ownPrefix = `${this.adapter.namespace}.`;
    const objects: Record<string, ioBroker.Object> = {};
    for (const design of ["device", "channel", "state"] as const) {
      const view = await this.adapter.getObjectViewAsync("system", design, {});
      for (const row of view?.rows ?? []) {
        if (row.value && !row.id.startsWith(ownPrefix)) {
          objects[row.id] = row.value;
        }
      }
    }
    // v1.19.0 (audit 2026-09-25 H8): the function enums. type-detector 6.0.1 counts a
    // relay (`switch`) or a `level.brightness` dimmer as a light only when it sits in
    // `enum.functions.light` (roleOrEnumLight → getFunctionEnums reads them from this
    // very map) — without them the scan never found those lights.
    const enums = await this.adapter.getObjectViewAsync("system", "enum", {
      startkey: "enum.functions.",
      endkey: "enum.functions.\u9999",
    });
    for (const row of enums?.rows ?? []) {
      if (row.value) {
        objects[row.id] = row.value;
      }
    }
    return objects;
  }
}
