/**
 * v1.11.0: ioBroker Device-Manager backend for the hueemu devices tab.
 *
 * Replaces the jsonConfig accordion with the sanctioned device-manager UI so
 * that manual add/edit/delete and an "assistant" (scan for lights via
 * `@iobroker/type-detector`) live side by side in ONE tab. The device list is
 * the adapter's own light objects (`lights.<n>`, light-store.ts — audit R-24; up
 * to v1.19.0 the instance's `native.devices`, and every change restarted the
 * instance). The running adapter serves a changed light at once; the manager
 * reloads the list afterwards.
 *
 * The edit/add form reuses the exact same fields as the old accordion (object
 * pickers, light type, scales), rendered natively by admin. All user-facing
 * text (form labels, action titles, confirmations, messages) is resolved to a
 * full 11-language translation object via `t()` so it renders correctly in every
 * admin language regardless of how the device-manager frontend resolves strings.
 */

import type { AdapterInstance } from "@iobroker/adapter-core";
import {
  DeviceManagement,
  type DeviceInfo,
  type DeviceLoadContext,
  type ActionContext,
  type JsonFormSchema,
} from "@iobroker/dm-utils";
import type { DeviceConfig } from "./hue-api";
import { boundStateIds, scanForLightDevices } from "./lib/device-scan";
import { nameIn, t } from "./lib/i18n";
import type { LightStore } from "./lib/light-store";
import { SCALE_FIELDS } from "./lib/hue-scales";
import { errText } from "./lib/err-text";
import { oneLine } from "./types/utils";

/** Manager directive returned by an instance action — reload the whole view. */
type InstanceResult = { refresh: boolean };
/** Manager directive returned by a per-device action — reload the device list. */
type DeviceResult = { refresh: "instance" };

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
 * so a light object's `native` stays tidy.
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
 * A stored scale belongs to the datapoint it was set for. When an edit binds
 * another datapoint and leaves the scale as it was, the scale goes back to
 * "automatic" and the next start settles it from the new datapoint — the old one
 * read and wrote every value of the new source wrong (audit R-23). A scale the
 * user picks in the same step stays.
 *
 * @param before The stored entry.
 * @param after The cleaned form result.
 * @returns `after` without the scales that no longer belong to their datapoint.
 */
export function resetReboundScales(before: DeviceConfig, after: DeviceConfig): DeviceConfig {
  const out = { ...after };
  for (const { state, scale } of SCALE_FIELDS) {
    if (after[state] !== before[state] && after[scale] !== undefined && after[scale] === before[scale]) {
      delete out[scale];
    }
  }
  return out;
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
 * ioBroker device-manager backend: exposes the light objects as device cards with
 * add/edit/delete actions plus a "search lights" assistant. Owns no state of its
 * own — it reads and writes the lights through the light store.
 */
export class HueEmuDeviceManagement extends DeviceManagement {
  private readonly lights: LightStore;

  /**
   * @param adapter The adapter.
   * @param lights The light store the adapter serves from — one queue for every change.
   */
  public constructor(adapter: AdapterInstance, lights: LightStore) {
    super(adapter);
    this.lights = lights;
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
   * Populate the device-manager list from the light objects.
   *
   * Reading them can fail (objects DB unreachable). This path has no
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
      const { lights } = await this.lights.list();
      lights.forEach(device => context.addDevice(this.toDeviceInfo(device)));
    } catch (e) {
      this.adapter.log.warn(`Could not read the configured lights: ${errText(e)}`);
    }
  }

  /**
   * The light a card names, in the list as it is right now. The card id is the light's
   * permanent number — unique by construction, so a list that shifted between rendering
   * and acting never points the action at another light (audit 2026-09-06 F10,
   * 2026-09-15 A2).
   *
   * @param cardId The id the card was built with.
   * @returns the light, undefined when it is gone
   */
  private async lightOfCard(cardId: string): Promise<(DeviceConfig & { id: number }) | undefined> {
    const { lights } = await this.lights.list();
    const light = lights.find(d => String(d.id) === cardId);
    return light ? (light as DeviceConfig & { id: number }) : undefined;
  }

  /**
   * Build one device card with edit/delete actions.
   *
   * @param device The stored light, carrying its number.
   * @returns The device-manager card descriptor.
   */
  private toDeviceInfo(device: DeviceConfig): DeviceInfo<string> {
    return {
      id: String(device.id),
      name: device.name || t("lightNameFallback", device.id ?? 0),
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
   * Manual add: show the empty form and store a valid result as a new light — its
   * number comes from the store, never from the form.
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
      const { id: _ignored, ...config } = cleanDevice(data);
      for (const added of await this.lights.add([config])) {
        this.adapter.log.info(`Light "${oneLine(added.name)}" added as light ${added.id}`);
      }
    }
    return { refresh: true };
  }

  /**
   * Edit a light via the form.
   *
   * @param cardId The card id the action was raised on.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async editDevice(cardId: string, context: ActionContext): Promise<DeviceResult> {
    const current = await this.lightOfCard(cardId);
    if (!current) {
      return { refresh: "instance" };
    }
    const data = await context.showForm(buildDeviceForm(), {
      title: t("dmEditTitle"),
      data: { ...current },
    });
    if (data && typeof data.name === "string" && data.name) {
      // The number is the light's identity for every paired client — it stays
      // with the light, whatever the form sent back.
      const edited = { ...resetReboundScales(current, cleanDevice(data)), id: current.id };
      if (await this.lights.save(edited)) {
        this.adapter.log.info(`Light ${current.id} "${oneLine(edited.name)}" saved`);
      }
    }
    return { refresh: "instance" };
  }

  /**
   * Delete a light after confirmation.
   *
   * @param cardId The card id the action was raised on.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async deleteDevice(cardId: string, context: ActionContext): Promise<DeviceResult> {
    const target = await this.lightOfCard(cardId);
    if (!target) {
      return { refresh: "instance" };
    }
    const confirmed = await context.showConfirmation(t("dmDeleteConfirm", target.name || ""));
    if (confirmed) {
      await this.lights.remove(target.id);
      this.adapter.log.info(`Light ${target.id} "${oneLine(target.name)}" deleted`);
    }
    return { refresh: "instance" };
  }

  /**
   * Assistant: scan the object tree for light devices and add the ones that are
   * not mapped yet. hueemu's own namespace is excluded (its emulated lights would
   * otherwise be re-detected as sources), and a light that shares any bound
   * datapoint with a stored one is never offered — manual edits and repeated scans
   * stay non-destructive.
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
      const { devices: found, unmapped } = scanForLightDevices(
        objects,
        (id, obj) => nameIn(obj.common?.name, this.adapter.language) || id,
      );

      const { lights: existing } = await this.lights.list();
      // Dedup over EVERY bound state: a light that shares any source with a
      // stored one is already in the bridge. v1.18.0: the check used to look at
      // the on/off state only, so a light without one (a dimmer with nothing but
      // a level) was offered — and stored — again on every scan (audit 2026-09-15 A1).
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
        await context.showMessage(
          unmapped.length ? t("dmScanAddedSkipped", chosen.length, unmapped.length) : t("dmScanAdded", chosen.length),
        );
        for (const light of await this.lights.add(chosen)) {
          this.adapter.log.info(`Light "${oneLine(light.name)}" added as light ${light.id}`);
        }
      }
    } catch (e) {
      await closeProgress();
      await context.showMessage(t("dmScanFailed", errText(e)));
    }
    return { refresh: true };
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
