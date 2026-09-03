"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var device_management_exports = {};
__export(device_management_exports, {
  HueEmuDeviceManagement: () => HueEmuDeviceManagement,
  buildDeviceForm: () => buildDeviceForm,
  buildSelectionForm: () => buildSelectionForm,
  cleanDevice: () => cleanDevice
});
module.exports = __toCommonJS(device_management_exports);
var import_dm_utils = require("@iobroker/dm-utils");
var import_device_scan = require("./lib/device-scan");
var import_i18n = require("./lib/i18n");
const FIELDS_BY_TYPE = {
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
    "xyState"
  ]
};
function buildDeviceForm() {
  return {
    type: "panel",
    items: {
      name: { type: "text", label: (0, import_i18n.t)("deviceName"), default: "New Light", sm: 12, md: 6 },
      lightType: {
        type: "select",
        label: (0, import_i18n.t)("lightType"),
        default: "dimmable",
        options: [
          { label: (0, import_i18n.t)("lightTypeOnOff"), value: "onoff" },
          { label: (0, import_i18n.t)("lightTypeDimmable"), value: "dimmable" },
          { label: (0, import_i18n.t)("lightTypeCT"), value: "ct" },
          { label: (0, import_i18n.t)("lightTypeColor"), value: "color" }
        ],
        sm: 12,
        md: 6
      },
      onState: { type: "objectId", label: (0, import_i18n.t)("stateOn"), tooltip: (0, import_i18n.t)("stateOnTooltip"), sm: 12, md: 6 },
      briState: {
        type: "objectId",
        label: (0, import_i18n.t)("stateBri"),
        tooltip: (0, import_i18n.t)("stateBriTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType === 'onoff'"
      },
      briScale: {
        type: "select",
        label: (0, import_i18n.t)("scaleBri"),
        tooltip: (0, import_i18n.t)("scaleTooltip"),
        default: "auto",
        options: [
          { label: (0, import_i18n.t)("scaleAuto"), value: "auto" },
          { label: (0, import_i18n.t)("scalePercent"), value: "percent" },
          { label: (0, import_i18n.t)("scaleNormalized"), value: "normalized" },
          { label: (0, import_i18n.t)("scaleRaw"), value: "raw" }
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType === 'onoff'"
      },
      ctState: {
        type: "objectId",
        label: (0, import_i18n.t)("stateCt"),
        tooltip: (0, import_i18n.t)("stateCtTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'ct' && data.lightType !== 'color'"
      },
      ctScale: {
        type: "select",
        label: (0, import_i18n.t)("scaleCt"),
        tooltip: (0, import_i18n.t)("scaleCtTooltip"),
        default: "raw",
        options: [
          { label: (0, import_i18n.t)("scaleNative"), value: "raw" },
          { label: (0, import_i18n.t)("scaleKelvin"), value: "kelvin" }
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'ct' && data.lightType !== 'color'"
      },
      hueState: {
        type: "objectId",
        label: (0, import_i18n.t)("stateHue"),
        tooltip: (0, import_i18n.t)("stateHueTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'color'"
      },
      hueScale: {
        type: "select",
        label: (0, import_i18n.t)("scaleHue"),
        tooltip: (0, import_i18n.t)("scaleHueTooltip"),
        default: "raw",
        options: [
          { label: (0, import_i18n.t)("scaleNative"), value: "raw" },
          { label: (0, import_i18n.t)("scaleDegrees"), value: "degrees" }
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'color'"
      },
      satState: {
        type: "objectId",
        label: (0, import_i18n.t)("stateSat"),
        tooltip: (0, import_i18n.t)("stateSatTooltip"),
        sm: 12,
        md: 4,
        hidden: "data.lightType !== 'color'"
      },
      satScale: {
        type: "select",
        label: (0, import_i18n.t)("scaleSat"),
        tooltip: (0, import_i18n.t)("scaleTooltip"),
        default: "auto",
        options: [
          { label: (0, import_i18n.t)("scaleAuto"), value: "auto" },
          { label: (0, import_i18n.t)("scalePercent"), value: "percent" },
          { label: (0, import_i18n.t)("scaleNormalized"), value: "normalized" },
          { label: (0, import_i18n.t)("scaleRaw"), value: "raw" }
        ],
        sm: 12,
        md: 2,
        hidden: "data.lightType !== 'color'"
      },
      xyState: {
        type: "objectId",
        label: (0, import_i18n.t)("stateXy"),
        tooltip: (0, import_i18n.t)("stateXyTooltip"),
        sm: 12,
        md: 6,
        hidden: "data.lightType !== 'color'"
      }
    }
  };
}
function cleanDevice(raw) {
  const type = typeof raw.lightType === "string" ? raw.lightType : "";
  const allowed = FIELDS_BY_TYPE[type];
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === "" || value === void 0 || value === null) {
      continue;
    }
    if (allowed && !allowed.includes(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
function buildSelectionForm(devices) {
  const items = {
    _hint: { type: "staticText", text: (0, import_i18n.t)("dmSelectHint"), sm: 12 }
  };
  devices.forEach((device, index) => {
    const suffix = device.onState ? ` \xB7 ${device.onState}` : "";
    items[`sel_${index}`] = {
      type: "checkbox",
      label: `${device.name} \xB7 ${device.lightType}${suffix}`,
      default: false,
      sm: 12
    };
  });
  return { type: "panel", items };
}
class HueEmuDeviceManagement extends import_dm_utils.DeviceManagement {
  /** The `system.adapter.*` object id whose `native.devices` holds the mapping list. */
  get objId() {
    return `system.adapter.${this.adapter.namespace}`;
  }
  /**
   * Read the device list fresh from the live config object (so it reflects a
   * write that is still triggering a restart).
   *
   * @returns The configured devices, or an empty list if none.
   */
  async readDevices() {
    var _a;
    const obj = await this.adapter.getForeignObjectAsync(this.objId);
    const devices = (_a = obj == null ? void 0 : obj.native) == null ? void 0 : _a.devices;
    return Array.isArray(devices) ? devices : [];
  }
  /**
   * Persist the device list. Writing `native.*` restarts the adapter, which
   * re-binds the lights with the new mappings.
   *
   * @param devices The full device list to store.
   */
  async writeDevices(devices) {
    await this.adapter.extendForeignObjectAsync(this.objId, { native: { devices } });
  }
  /**
   * Populate the device-manager list from `native.devices`.
   *
   * @param context The load context to add one card per device to.
   */
  async loadDevices(context) {
    const devices = await this.readDevices();
    devices.forEach((device, index) => context.addDevice(this.toDeviceInfo(device, index)));
  }
  /**
   * Build one device card with edit/delete actions.
   *
   * @param device The stored mapping.
   * @param index Its position in the list — used as the (per-session stable) card id.
   * @returns The device-manager card descriptor.
   */
  toDeviceInfo(device, index) {
    return {
      id: String(index),
      name: device.name || `Light ${index + 1}`,
      actions: [
        {
          id: "edit",
          icon: "edit",
          description: (0, import_i18n.t)("dmEdit"),
          handler: async (id, context) => this.editDevice(Number(id), context)
        },
        {
          id: "delete",
          icon: "delete",
          description: (0, import_i18n.t)("dmDelete"),
          handler: async (id, context) => this.deleteDevice(Number(id), context)
        }
      ]
    };
  }
  /**
   * Instance-level actions shown above the device list: manual add + the search
   * assistant.
   *
   * @returns The instance action descriptor.
   */
  getInstanceInfo() {
    return {
      apiVersion: "v3",
      actions: [
        {
          id: "add",
          icon: "add",
          title: (0, import_i18n.t)("dmAddLight"),
          handler: async (context) => this.addDevice(context)
        },
        {
          id: "search",
          icon: "search",
          title: (0, import_i18n.t)("dmSearchLights"),
          handler: async (context) => this.searchDevices(context)
        }
      ]
    };
  }
  /**
   * Manual add: show the empty form and append a valid result.
   *
   * @param context The action context.
   * @returns A directive to reload the manager.
   */
  async addDevice(context) {
    const data = await context.showForm(buildDeviceForm(), {
      title: (0, import_i18n.t)("dmAddLight"),
      data: { lightType: "dimmable" }
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
  async editDevice(index, context) {
    const devices = await this.readDevices();
    const current = devices[index];
    if (!current) {
      return { refresh: "instance" };
    }
    const data = await context.showForm(buildDeviceForm(), {
      title: (0, import_i18n.t)("dmEditTitle"),
      data: { ...current }
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
  async deleteDevice(index, context) {
    const devices = await this.readDevices();
    const target = devices[index];
    if (!target) {
      return { refresh: "instance" };
    }
    const confirmed = await context.showConfirmation((0, import_i18n.t)("dmDeleteConfirm", target.name || ""));
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
  async searchDevices(context) {
    const progress = await context.openProgress((0, import_i18n.t)("dmSearching"), { indeterminate: true });
    let progressClosed = false;
    const closeProgress = async () => {
      if (!progressClosed) {
        progressClosed = true;
        await progress.close();
      }
    };
    try {
      const objects = await this.loadAllObjects();
      const { devices: found, unmapped } = (0, import_device_scan.scanForLightDevices)(objects, (id, obj) => {
        var _a;
        const name = (_a = obj.common) == null ? void 0 : _a.name;
        return typeof name === "string" && name || id;
      });
      const existing = await this.readDevices();
      const mappedIds = new Set(
        existing.flatMap((d) => [d.onState, d.briState, d.ctState, d.hueState, d.satState, d.xyState].filter(Boolean))
      );
      const fresh = found.filter((d) => !d.onState || !mappedIds.has(d.onState));
      await closeProgress();
      if (!fresh.length) {
        await context.showMessage(unmapped.length ? (0, import_i18n.t)("dmScanNoneSkipped", unmapped.length) : (0, import_i18n.t)("dmScanNone"));
        return { refresh: true };
      }
      const selection = await context.showForm(buildSelectionForm(fresh), { title: (0, import_i18n.t)("dmSelectTitle"), data: {} });
      if (selection) {
        const chosen = fresh.filter((_, index) => selection[`sel_${index}`] === true);
        if (chosen.length) {
          await this.writeDevices([...existing, ...chosen]);
        }
        await context.showMessage(
          unmapped.length ? (0, import_i18n.t)("dmScanAddedSkipped", chosen.length, unmapped.length) : (0, import_i18n.t)("dmScanAdded", chosen.length)
        );
      }
    } catch (e) {
      await closeProgress();
      await context.showMessage((0, import_i18n.t)("dmScanFailed", e instanceof Error ? e.message : String(e)));
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
  async loadAllObjects() {
    var _a;
    const ownPrefix = `${this.adapter.namespace}.`;
    const objects = {};
    for (const design of ["device", "channel", "state"]) {
      const view = await this.adapter.getObjectViewAsync("system", design, {});
      for (const row of (_a = view == null ? void 0 : view.rows) != null ? _a : []) {
        if (row.value && !row.id.startsWith(ownPrefix)) {
          objects[row.id] = row.value;
        }
      }
    }
    return objects;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HueEmuDeviceManagement,
  buildDeviceForm,
  buildSelectionForm,
  cleanDevice
});
//# sourceMappingURL=device-management.js.map
