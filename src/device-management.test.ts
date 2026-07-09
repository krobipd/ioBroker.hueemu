/**
 * Tests for the Device-Manager backend. i18n is mocked (so `t()` returns the key
 * and the tests don't depend on I18n.init), but the "search" test drives the REAL
 * @iobroker/type-detector over sample objects so the own-namespace exclusion and
 * append-only dedup are proven end-to-end, not stubbed.
 */

import { vi } from "vitest";

// Mock the i18n wrapper: user-facing text is not under test here.
vi.mock("./lib/i18n", () => ({
  t: (key: string, ...args: unknown[]) => (args.length ? { key, args } : key),
  tName: (key: string) => key,
}));

import { HueEmuDeviceManagement, cleanDevice, buildDeviceForm } from "./device-management";
import type { DeviceConfig } from "./hue-api";

/** A running-config mock adapter backed by an in-memory native.devices array. */
function mockAdapter(devices: DeviceConfig[] = [], allObjects: Record<string, unknown> = {}): any {
  let stored = devices;
  return {
    namespace: "hueemu.0",
    on: vi.fn(),
    getForeignObjectAsync: vi.fn(async (id: string) =>
      id === "system.adapter.hueemu.0" ? { native: { devices: stored } } : null,
    ),
    extendForeignObjectAsync: vi.fn(async (_id: string, patch: { native: { devices: DeviceConfig[] } }) => {
      stored = patch.native.devices;
    }),
    getForeignObjectsAsync: vi.fn(async () => allObjects),
    _stored: () => stored,
  };
}

/** A mock ActionContext with configurable form/confirmation results. */
function mockContext(opts: { form?: unknown; confirm?: boolean } = {}): any {
  return {
    showForm: vi.fn(async () => opts.form),
    showConfirmation: vi.fn(async () => opts.confirm ?? true),
    showMessage: vi.fn(async () => undefined),
    openProgress: vi.fn(async () => ({ update: vi.fn(), close: vi.fn(async () => undefined) })),
  };
}

/** Build a channel device with `[suffix, role, type?]` state children (detector-friendly). */
function channel(prefix: string, states: [string, string, ioBroker.CommonType?][]): Record<string, ioBroker.Object> {
  const objs: Record<string, ioBroker.Object> = {
    [prefix]: { _id: prefix, type: "channel", common: { role: "light", name: prefix }, native: {} } as ioBroker.Object,
  };
  for (const [suf, role, t] of states) {
    const id = `${prefix}.${suf}`;
    objs[id] = {
      _id: id,
      type: "state",
      common: { role, type: t ?? "number", read: true, write: true, name: id },
      native: {},
    } as ioBroker.Object;
  }
  return objs;
}

describe("cleanDevice", () => {
  it("drops fields not relevant to an on/off light", () => {
    const out = cleanDevice({ name: "L", lightType: "onoff", onState: "a.on", briState: "a.bri", hueState: "a.hue" });
    expect(out).toEqual({ name: "L", lightType: "onoff", onState: "a.on" });
  });

  it("keeps all colour fields for a colour light", () => {
    const raw = { name: "C", lightType: "color", onState: "a", briState: "b", hueState: "h", satState: "s", xyState: "x" };
    expect(cleanDevice(raw)).toEqual(raw);
  });

  it("drops empty-string pickers", () => {
    const out = cleanDevice({ name: "D", lightType: "dimmable", onState: "a.on", briState: "" });
    expect(out).toEqual({ name: "D", lightType: "dimmable", onState: "a.on" });
  });

  it("prunes stale colour fields when a colour light becomes on/off (edit)", () => {
    const out = cleanDevice({ name: "L", lightType: "onoff", onState: "a", hueState: "old", ctState: "old", xyState: "old" });
    expect(out).toEqual({ name: "L", lightType: "onoff", onState: "a" });
  });
});

describe("buildDeviceForm", () => {
  it("returns a panel with all mapping fields", () => {
    const form = buildDeviceForm() as { type: string; items: Record<string, unknown> };
    expect(form.type).toBe("panel");
    expect(Object.keys(form.items)).toEqual([
      "name", "lightType", "onState", "briState", "briScale",
      "ctState", "ctScale", "hueState", "hueScale", "satState", "satScale", "xyState",
    ]);
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
      await (dm as any).loadDevices(ctx);
      expect(ctx.addDevice).toHaveBeenCalledTimes(2);
      expect(ctx.addDevice.mock.calls[0][0]).toMatchObject({ id: "0", name: "Kitchen" });
      expect(ctx.addDevice.mock.calls[1][0]).toMatchObject({ id: "1", name: "Hall" });
    });

    it("adds nothing when native.devices is missing", async () => {
      const adapter = make();
      adapter.getForeignObjectAsync.mockResolvedValueOnce({ native: {} });
      const ctx = { addDevice: vi.fn() };
      await (dm as any).loadDevices(ctx);
      expect(ctx.addDevice).not.toHaveBeenCalled();
    });
  });

  describe("add / edit / delete", () => {
    it("appends a valid form result", async () => {
      const adapter = make([]);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "x.on" } });
      const res = await (dm as any).addDevice(ctx);
      expect(res).toEqual({ refresh: true });
      expect(adapter._stored()).toEqual([{ name: "New", lightType: "onoff", onState: "x.on" }]);
    });

    it("does not write when the add form is cancelled", async () => {
      const adapter = make([]);
      await (dm as any).addDevice(mockContext({ form: undefined }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("does not write when the add form has no name", async () => {
      const adapter = make([]);
      await (dm as any).addDevice(mockContext({ form: { name: "", lightType: "onoff" } }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("replaces the edited device in place", async () => {
      const adapter = make([{ name: "Old", lightType: "onoff", onState: "a.on" }]);
      const ctx = mockContext({ form: { name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" } });
      await (dm as any).editDevice(0, ctx);
      expect(adapter._stored()).toEqual([{ name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" }]);
    });

    it("deletes on confirmation and keeps others", async () => {
      const adapter = make([
        { name: "A", lightType: "onoff", onState: "a" },
        { name: "B", lightType: "onoff", onState: "b" },
      ]);
      await (dm as any).deleteDevice(0, mockContext({ confirm: true }));
      expect(adapter._stored()).toEqual([{ name: "B", lightType: "onoff", onState: "b" }]);
    });

    it("does not delete when the confirmation is declined", async () => {
      const adapter = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      await (dm as any).deleteDevice(0, mockContext({ confirm: false }));
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });
  });

  describe("searchDevices (real detector)", () => {
    it("adds foreign lights but excludes hueemu's own namespace", async () => {
      const objs = {
        ...channel("lampe.0.wohnzimmer", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"]]),
        // hueemu's own emulated light — must NOT be re-detected as a source:
        ...channel("hueemu.0.1.state", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"]]),
      };
      const adapter = make([], objs);
      const ctx = mockContext();
      const res = await (dm as any).searchDevices(ctx);
      expect(res).toEqual({ refresh: true });
      const stored = adapter._stored();
      expect(stored).toHaveLength(1);
      expect(stored[0].onState).toBe("lampe.0.wohnzimmer.on");
      expect(stored.some((d: DeviceConfig) => d.onState?.startsWith("hueemu.0"))).toBe(false);
      expect(ctx.showMessage).toHaveBeenCalled();
    });

    it("does not re-add a light already mapped (append-only dedup)", async () => {
      const objs = channel("lampe.0.flur", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"]]);
      const adapter = make([{ name: "Flur", lightType: "dimmable", onState: "lampe.0.flur.on", briState: "lampe.0.flur.bri" }], objs);
      await (dm as any).searchDevices(mockContext());
      // nothing new to persist → no write
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });
  });
});
