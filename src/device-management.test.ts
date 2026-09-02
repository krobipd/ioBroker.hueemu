/**
 * Tests for the Device-Manager backend. i18n is mocked (so `t()` returns the key
 * and the tests don't depend on I18n.init), but the "search" test drives the REAL
 * `@iobroker/type-detector` over sample objects so the own-namespace exclusion and
 * append-only dedup are proven end-to-end, not stubbed.
 */

import { vi } from "vitest";

// Mock the i18n wrapper: user-facing text is not under test here.
vi.mock("./lib/i18n", () => ({
  t: (key: string, ...args: unknown[]) => (args.length ? { key, args } : key),
  tName: (key: string) => key,
}));

import { HueEmuDeviceManagement, cleanDevice, buildDeviceForm, buildSelectionForm } from "./device-management";
import type { DeviceConfig } from "./hue-api";

/**
 * A running-config mock adapter backed by an in-memory native.devices array.
 *
 * @param devices The initial native.devices list
 * @param allObjects Every object the fake object view returns (id → object)
 */
function mockAdapter(devices: DeviceConfig[] = [], allObjects: Record<string, unknown> = {}): any {
  let stored = devices;
  return {
    namespace: "hueemu.0",
    on: vi.fn(),
    getForeignObjectAsync: vi.fn((id: string) =>
      Promise.resolve(id === "system.adapter.hueemu.0" ? { native: { devices: stored } } : null),
    ),
    extendForeignObjectAsync: vi.fn((_id: string, patch: { native: { devices: DeviceConfig[] } }) => {
      stored = patch.native.devices;
      return Promise.resolve();
    }),
    getForeignObjectsAsync: vi.fn(() => Promise.resolve(allObjects)),
    // A1: searchDevices now loads via getObjectView per type. Return the objects
    // of the requested design ("device" | "channel" | "state"), like js-controller.
    getObjectViewAsync: vi.fn((_system: string, design: string) =>
      Promise.resolve({
        rows: Object.entries(allObjects)
          .filter(([, o]) => (o as ioBroker.Object).type === design)
          .map(([id, value]) => ({ id, value })),
      }),
    ),
    _stored: () => stored,
  };
}

/**
 * A mock ActionContext with configurable form/confirmation results.
 *
 * @param opts Dialog results the fake context hands back
 * @param opts.form Result of showForm (undefined = cancelled)
 * @param opts.confirm Result of showConfirmation (default true)
 */
function mockContext(opts: { form?: unknown; confirm?: boolean } = {}): MockCtx {
  return {
    showForm: vi.fn(() => Promise.resolve(opts.form)),
    showConfirmation: vi.fn(() => Promise.resolve(opts.confirm ?? true)),
    showMessage: vi.fn(() => Promise.resolve(undefined)),
    openProgress: vi.fn(() => Promise.resolve({ update: vi.fn(), close: vi.fn(() => Promise.resolve(undefined)) })),
  };
}

/** The slice of the device-manager ActionContext the backend calls, as vi mocks. */
interface MockCtx {
  showForm: ReturnType<typeof vi.fn>;
  showConfirmation: ReturnType<typeof vi.fn>;
  showMessage: ReturnType<typeof vi.fn>;
  openProgress: ReturnType<typeof vi.fn>;
}

/**
 * Typed access to the private DeviceManagement methods the tests drive — mirrors
 * the internalOf() seam in main.test.ts and replaces the previous `(dm as any)`.
 */
interface DmInternals {
  loadDevices(ctx: { addDevice: (info: unknown) => void }): Promise<void>;
  addDevice(ctx: MockCtx): Promise<{ refresh: boolean }>;
  editDevice(index: number, ctx: MockCtx): Promise<{ refresh: "instance" }>;
  deleteDevice(index: number, ctx: MockCtx): Promise<{ refresh: "instance" }>;
  searchDevices(ctx: MockCtx): Promise<{ refresh: boolean }>;
}
const internalOf = (dm: HueEmuDeviceManagement): DmInternals => dm as unknown as DmInternals;

/**
 * Build a channel device with `[suffix, role, type?]` state children (detector-friendly).
 *
 * @param prefix The channel id (device prefix of the state ids)
 * @param states `[suffix, role, type?]` tuples for the state children
 */
function channel(prefix: string, states: [string, string, ioBroker.CommonType?][]): Record<string, ioBroker.Object> {
  const objs: Record<string, ioBroker.Object> = {
    [prefix]: { _id: prefix, type: "channel", common: { role: "light", name: prefix }, native: {} },
  };
  for (const [suf, role, t] of states) {
    const id = `${prefix}.${suf}`;
    objs[id] = {
      _id: id,
      type: "state",
      common: { role, type: t ?? "number", read: true, write: true, name: id },
      native: {},
    };
  }
  return objs;
}

describe("cleanDevice", () => {
  it("drops fields not relevant to an on/off light", () => {
    const out = cleanDevice({ name: "L", lightType: "onoff", onState: "a.on", briState: "a.bri", hueState: "a.hue" });
    expect(out).toEqual({ name: "L", lightType: "onoff", onState: "a.on" });
  });

  it("keeps all colour fields for a colour light", () => {
    const raw = {
      name: "C",
      lightType: "color",
      onState: "a",
      briState: "b",
      hueState: "h",
      satState: "s",
      xyState: "x",
    };
    expect(cleanDevice(raw)).toEqual(raw);
  });

  it("drops empty-string pickers", () => {
    const out = cleanDevice({ name: "D", lightType: "dimmable", onState: "a.on", briState: "" });
    expect(out).toEqual({ name: "D", lightType: "dimmable", onState: "a.on" });
  });

  it("prunes stale colour fields when a colour light becomes on/off (edit)", () => {
    const out = cleanDevice({
      name: "L",
      lightType: "onoff",
      onState: "a",
      hueState: "old",
      ctState: "old",
      xyState: "old",
    });
    expect(out).toEqual({ name: "L", lightType: "onoff", onState: "a" });
  });
});

describe("buildDeviceForm", () => {
  it("returns a panel with all mapping fields", () => {
    const form = buildDeviceForm() as { type: string; items: Record<string, unknown> };
    expect(form.type).toBe("panel");
    expect(Object.keys(form.items)).toEqual([
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
    ]);
  });
});

describe("buildSelectionForm", () => {
  it("makes one unticked checkbox per detected light, labelled with name/type/state", () => {
    const form = buildSelectionForm([
      { name: "A", lightType: "onoff", onState: "x.on" },
      { name: "B", lightType: "ct", onState: "y.on" },
    ]) as { type: string; items: Record<string, { type?: string; default?: boolean; label?: string }> };
    expect(form.type).toBe("panel");
    expect(form.items.sel_0.type).toBe("checkbox");
    expect(form.items.sel_0.default).toBe(false);
    expect(form.items.sel_0.label).toContain("A");
    expect(form.items.sel_1.label).toContain("B");
  });
});

describe("HueEmuDeviceManagement", () => {
  let dm: HueEmuDeviceManagement;

  function make(devices: DeviceConfig[] = [], objs: Record<string, unknown> = {}): any {
    const adapter = mockAdapter(devices, objs);
    dm = new HueEmuDeviceManagement(adapter);
    return adapter;
  }

  describe("loadDevices", () => {
    it("adds one card per configured device with stable index ids", async () => {
      make([
        { name: "Kitchen", lightType: "onoff", onState: "a.on" },
        { name: "Hall", lightType: "dimmable", onState: "b.on", briState: "b.bri" },
      ]);
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      expect(ctx.addDevice).toHaveBeenCalledTimes(2);
      expect(ctx.addDevice.mock.calls[0][0]).toMatchObject({ id: "0", name: "Kitchen" });
      expect(ctx.addDevice.mock.calls[1][0]).toMatchObject({ id: "1", name: "Hall" });
    });

    it("adds nothing when native.devices is missing", async () => {
      const adapter = make();
      adapter.getForeignObjectAsync.mockResolvedValueOnce({ native: {} });
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      expect(ctx.addDevice).not.toHaveBeenCalled();
    });
  });

  describe("add / edit / delete", () => {
    it("appends a valid form result", async () => {
      const adapter = make([]);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "x.on" } });
      const res = await internalOf(dm).addDevice(ctx);
      expect(res).toEqual({ refresh: true });
      expect(adapter._stored()).toEqual([{ name: "New", lightType: "onoff", onState: "x.on" }]);
    });

    it("does not write when the add form is cancelled", async () => {
      const adapter = make([]);
      await internalOf(dm).addDevice(mockContext({ form: undefined }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("does not write when the add form has no name", async () => {
      const adapter = make([]);
      await internalOf(dm).addDevice(mockContext({ form: { name: "", lightType: "onoff" } }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("replaces the edited device in place", async () => {
      const adapter = make([{ name: "Old", lightType: "onoff", onState: "a.on" }]);
      const ctx = mockContext({ form: { name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" } });
      await internalOf(dm).editDevice(0, ctx);
      expect(adapter._stored()).toEqual([
        { name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" },
      ]);
    });

    it("deletes on confirmation and keeps others", async () => {
      const adapter = make([
        { name: "A", lightType: "onoff", onState: "a" },
        { name: "B", lightType: "onoff", onState: "b" },
      ]);
      await internalOf(dm).deleteDevice(0, mockContext({ confirm: true }));
      expect(adapter._stored()).toEqual([{ name: "B", lightType: "onoff", onState: "b" }]);
    });

    it("edit / delete on a stale index do nothing (list changed under the dialog)", async () => {
      // The Device-Manager list is a snapshot: the user can open the edit or
      // delete action on a row that another admin session (or the add-flow)
      // has meanwhile removed. Acting on that index would rewrite or drop the
      // WRONG device — or write an `undefined` hole into native.devices.
      const adapterEdit = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      const editCtx = mockContext({ form: { name: "Ghost", lightType: "onoff", onState: "g" } });
      await internalOf(dm).editDevice(5, editCtx);
      expect(editCtx.showForm).not.toHaveBeenCalled();
      expect(adapterEdit.extendForeignObjectAsync).not.toHaveBeenCalled();

      const adapterDel = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      const delCtx = mockContext({ confirm: true });
      await internalOf(dm).deleteDevice(5, delCtx);
      expect(delCtx.showConfirmation).not.toHaveBeenCalled();
      expect(adapterDel.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("does not delete when the confirmation is declined", async () => {
      const adapter = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      await internalOf(dm).deleteDevice(0, mockContext({ confirm: false }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });
  });

  describe("searchDevices (real detector + selection)", () => {
    it("detects foreign lights, excludes own namespace, and adds only the ticked ones", async () => {
      const objs = {
        ...channel("lampe.0.wohnzimmer", [
          ["on", "switch.light", "boolean"],
          ["bri", "level.dimmer"],
        ]),
        // hueemu's own emulated light — must NOT be re-detected as a source:
        ...channel("hueemu.0.1.state", [
          ["on", "switch.light", "boolean"],
          ["bri", "level.dimmer"],
        ]),
      };
      const adapter = make([], objs);
      // Tick the single detected light in the selection form.
      const ctx = mockContext({ form: { sel_0: true } });
      const res = await internalOf(dm).searchDevices(ctx);
      expect(res).toEqual({ refresh: true });
      expect(ctx.showForm).toHaveBeenCalled();
      const stored = adapter._stored();
      expect(stored).toHaveLength(1);
      expect(stored[0].onState).toBe("lampe.0.wohnzimmer.on");
      expect(stored.some((d: DeviceConfig) => d.onState?.startsWith("hueemu.0"))).toBe(false);
      expect(ctx.showMessage).toHaveBeenCalled();
    });

    it("adds nothing when the user unticks everything", async () => {
      const objs = channel("lampe.0.kueche", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
      ]);
      const adapter = make([], objs);
      await internalOf(dm).searchDevices(mockContext({ form: {} })); // form returns, nothing ticked
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("adds nothing when the selection form is cancelled", async () => {
      const objs = channel("lampe.0.bad", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
      ]);
      const adapter = make([], objs);
      await internalOf(dm).searchDevices(mockContext({ form: undefined }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("does not offer an already-mapped light (append-only dedup) — no form shown", async () => {
      const objs = channel("lampe.0.flur", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
      ]);
      const adapter = make(
        [{ name: "Flur", lightType: "dimmable", onState: "lampe.0.flur.on", briState: "lampe.0.flur.bri" }],
        objs,
      );
      const ctx = mockContext();
      await internalOf(dm).searchDevices(ctx);
      expect(ctx.showForm).not.toHaveBeenCalled(); // nothing fresh → no picker
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    // C8: the scan-failure branch (object loading throws) reports via showMessage.
    it("reports a scan failure when object loading throws", async () => {
      const adapter = make([], {});
      adapter.getObjectViewAsync = vi.fn(() => Promise.reject(new Error("db down")));
      const ctx = mockContext();
      const res = await internalOf(dm).searchDevices(ctx);
      expect(res).toEqual({ refresh: true });
      // t() is mocked: t("dmScanFailed", "db down") → { key, args }
      expect(ctx.showMessage).toHaveBeenCalledWith({ key: "dmScanFailed", args: ["db down"] });
    });
  });
});
