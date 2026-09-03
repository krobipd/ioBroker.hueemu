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
import { scanForLightDevices } from "./lib/device-scan";
import { t } from "./lib/i18n";
import { errText } from "./types/utils";

/** Manager directive returned by an instance action — reload the whole view. */
type InstanceResult = { refresh: boolean };
/** Manager directive returned by a per-device action — reload the device list. */
type DeviceResult = { refresh: "instance" };

/** Which DeviceConfig fields are relevant per light type — used to prune the form result. */
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
        default: "auto",
        options: [
          { label: t("scaleAuto"), value: "auto" },
          { label: t("scalePercent"), value: "percent" },
          { label: t("scaleNormalized"), value: "normalized" },
          { label: t("scaleRaw"), value: "raw" },
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
        default: "raw",
        options: [
          { label: t("scaleNative"), value: "raw" },
          { label: t("scaleKelvin"), value: "kelvin" },
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
        default: "raw",
        options: [
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
        default: "auto",
        options: [
          { label: t("scaleAuto"), value: "auto" },
          { label: t("scalePercent"), value: "percent" },
          { label: t("scaleNormalized"), value: "normalized" },
          { label: t("scaleRaw"), value: "raw" },
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
 * Turn raw form data into a clean DeviceConfig: drop empty pickers and any
 * field not relevant to the chosen light type (e.g. a stale hueState left over
 * when a colour light is switched to on/off), so `native.devices` stays tidy.
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
   * Read the device list fresh from the live config object (so it reflects a
   * write that is still triggering a restart).
   *
   * @returns The configured devices, or an empty list if none.
   */
  private async readDevices(): Promise<DeviceConfig[]> {
    const obj = await this.adapter.getForeignObjectAsync(this.objId);
    const devices = (obj?.native as { devices?: unknown } | undefined)?.devices;
    return Array.isArray(devices) ? (devices as DeviceConfig[]) : [];
  }

  /**
   * Persist the device list. Writing `native.*` restarts the adapter, which
   * re-binds the lights with the new mappings.
   *
   * @param devices The full device list to store.
   */
  private async writeDevices(devices: DeviceConfig[]): Promise<void> {
    await this.adapter.extendForeignObjectAsync(this.objId, { native: { devices } });
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
    let devices: DeviceConfig[] = [];
    try {
      devices = await this.readDevices();
    } catch (e) {
      this.adapter.log.warn(`Could not read the configured lights: ${errText(e)}`);
      return;
    }
    devices.forEach((device, index) => context.addDevice(this.toDeviceInfo(device, index)));
  }

  /**
   * Build one device card with edit/delete actions.
   *
   * @param device The stored mapping.
   * @param index Its position in the list — used as the (per-session stable) card id.
   * @returns The device-manager card descriptor.
   */
  private toDeviceInfo(device: DeviceConfig, index: number): DeviceInfo<string> {
    return {
      id: String(index),
      name: device.name || `Light ${index + 1}`,
      actions: [
        {
          id: "edit",
          icon: "edit",
          description: t("dmEdit"),
          handler: async (id: string, context: ActionContext) =>
            this.guardAction<DeviceResult>(context, { refresh: "instance" }, () =>
              this.editDevice(Number(id), context),
            ),
        },
        {
          id: "delete",
          icon: "delete",
          description: t("dmDelete"),
          handler: async (id: string, context: ActionContext) =>
            this.guardAction<DeviceResult>(context, { refresh: "instance" }, () =>
              this.deleteDevice(Number(id), context),
            ),
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
      const devices = await this.readDevices();
      devices.push(cleanDevice(data));
      await this.writeDevices(devices);
    }
    return { refresh: true };
  }

  /**
   * Edit a device via the form, replacing it in place.
   *
   * @param index The device's list position.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async editDevice(index: number, context: ActionContext): Promise<DeviceResult> {
    const devices = await this.readDevices();
    const current = devices[index];
    if (!current) {
      return { refresh: "instance" };
    }
    const data = await context.showForm(buildDeviceForm(), {
      title: t("dmEditTitle"),
      data: { ...current },
    });
    if (data && typeof data.name === "string" && data.name) {
      devices[index] = cleanDevice(data);
      await this.writeDevices(devices);
    }
    return { refresh: "instance" };
  }

  /**
   * Delete a device after confirmation.
   *
   * @param index The device's list position.
   * @param context The action context.
   * @returns A directive to reload the list.
   */
  private async deleteDevice(index: number, context: ActionContext): Promise<DeviceResult> {
    const devices = await this.readDevices();
    const target = devices[index];
    if (!target) {
      return { refresh: "instance" };
    }
    const confirmed = await context.showConfirmation(t("dmDeleteConfirm", target.name || ""));
    if (confirmed) {
      devices.splice(index, 1);
      await this.writeDevices(devices);
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
      const { devices: found, unmapped } = scanForLightDevices(objects, (id, obj) => {
        const name = obj.common?.name;
        return (typeof name === "string" && name) || id;
      });

      const existing = await this.readDevices();
      const mappedIds = new Set(
        existing.flatMap(d => [d.onState, d.briState, d.ctState, d.hueState, d.satState, d.xyState].filter(Boolean)),
      );
      const fresh = found.filter(d => !d.onState || !mappedIds.has(d.onState));
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
        if (chosen.length) {
          await this.writeDevices([...existing, ...chosen]);
        }
        await context.showMessage(
          unmapped.length ? t("dmScanAddedSkipped", chosen.length, unmapped.length) : t("dmScanAdded", chosen.length),
        );
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
    return objects;
  }
}
