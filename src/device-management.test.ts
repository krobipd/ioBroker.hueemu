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
    log: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
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
    _setStored: (devices: DeviceConfig[]) => {
      stored = devices;
    },
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
  editDevice(cardId: string, ctx: MockCtx): Promise<{ refresh: "instance" }>;
  deleteDevice(cardId: string, ctx: MockCtx): Promise<{ refresh: "instance" }>;
  searchDevices(ctx: MockCtx): Promise<{ refresh: boolean }>;
  // The registered handlers — the entry points dm-utils actually calls.
  getInstanceInfo(): { actions?: { id: string; handler: (ctx: MockCtx) => Promise<unknown> }[] };
  toDeviceInfo(
    device: DeviceConfig,
    index: number,
  ): { actions?: { id: string; handler: (id: string, ctx: MockCtx) => Promise<unknown> }[] };
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

  // v1.17.0 (audit 2026-09-06 F1): "auto" was the form's preselection and it was
  // stored as a decision — which excluded the light from the scale derivation
  // for good. An edit drops it.
  it("drops an undecided scale so the light is derived again", () => {
    const out = cleanDevice({
      name: "D",
      lightType: "dimmable",
      onState: "a.on",
      briState: "a.bri",
      briScale: "auto",
    });
    expect(out).toEqual({ name: "D", lightType: "dimmable", onState: "a.on", briState: "a.bri" });
  });

  it("keeps a scale the user really picked", () => {
    const out = cleanDevice({
      name: "D",
      lightType: "dimmable",
      onState: "a.on",
      briState: "a.bri",
      briScale: "percent",
    });
    expect(out.briScale).toBe("percent");
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
    // v1.17.0: the card id is not the position — a list that shifts between
    // rendering and acting must not point the action at a different light
    // (audit 2026-09-06 F10). v1.18.0: it is the light's permanent number, which
    // two lights on the same source cannot share (audit 2026-09-15 A2).
    it("adds one card per configured device, keyed by its permanent number", async () => {
      make([
        { id: 4, name: "Kitchen", lightType: "onoff", onState: "a.on" },
        { id: 9, name: "Hall", lightType: "dimmable", onState: "b.on", briState: "b.bri" },
      ]);
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      expect(ctx.addDevice).toHaveBeenCalledTimes(2);
      expect(ctx.addDevice.mock.calls[0][0]).toMatchObject({ id: "4", name: "Kitchen" });
      expect(ctx.addDevice.mock.calls[1][0]).toMatchObject({ id: "9", name: "Hall" });
    });

    it("gives two lights on the same source two different cards", async () => {
      make([
        { id: 1, name: "Bedroom", lightType: "dimmable", briState: "hm.LEVEL" },
        { id: 2, name: "Bedroom (alias)", lightType: "dimmable", briState: "hm.LEVEL" },
      ]);
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      expect(ctx.addDevice.mock.calls.map(c => (c[0] as { id: string }).id)).toEqual(["1", "2"]);
    });

    it("falls back to the position for an entry the migration has not numbered yet", async () => {
      make([{ name: "Empty", lightType: "onoff" }]);
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      expect(ctx.addDevice.mock.calls[0][0]).toMatchObject({ id: "#0", name: "Empty" });
    });

    it("names a light without a name by its number, translated", async () => {
      make([{ id: 3, name: "", lightType: "onoff", onState: "a.on" }]);
      const ctx = { addDevice: vi.fn() };
      await internalOf(dm).loadDevices(ctx);
      // t() is mocked: t("lightNameFallback", 3) → { key, args }
      expect(ctx.addDevice.mock.calls[0][0]).toMatchObject({ name: { key: "lightNameFallback", args: [3] } });
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
    it("appends a valid form result with the next free number", async () => {
      const adapter = make([]);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "x.on" } });
      const res = await internalOf(dm).addDevice(ctx);
      expect(res).toEqual({ refresh: true });
      expect(adapter._stored()).toEqual([{ id: 1, name: "New", lightType: "onoff", onState: "x.on" }]);
    });

    // A deleted light's number is never handed out again — Alexa would otherwise
    // treat the new light as the old one.
    it("numbers a new light above every number ever used, not into a gap", async () => {
      const adapter = make([
        { id: 1, name: "A", lightType: "onoff", onState: "a" },
        { id: 3, name: "C", lightType: "onoff", onState: "c" },
      ]);
      await internalOf(dm).addDevice(mockContext({ form: { name: "New", lightType: "onoff", onState: "n" } }));
      expect(adapter._stored().map((d: DeviceConfig) => d.id)).toEqual([1, 3, 4]);
    });

    it("ignores a number the form tries to smuggle in", async () => {
      const adapter = make([{ id: 1, name: "A", lightType: "onoff", onState: "a" }]);
      await internalOf(dm).addDevice(mockContext({ form: { id: 1, name: "New", lightType: "onoff", onState: "n" } }));
      expect(adapter._stored()[1]).toEqual({ id: 2, name: "New", lightType: "onoff", onState: "n" });
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

    it("replaces the edited device in place and keeps its number", async () => {
      const adapter = make([{ id: 5, name: "Old", lightType: "onoff", onState: "a.on" }]);
      // The form hands back what it was seeded with (id included) — or not; the
      // stored entry decides either way.
      const ctx = mockContext({ form: { name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" } });
      await internalOf(dm).editDevice("5", ctx);
      expect(adapter._stored()).toEqual([
        { id: 5, name: "Renamed", lightType: "dimmable", onState: "a.on", briState: "a.bri" },
      ]);
    });

    it("keeps the number even when the form sends a different one", async () => {
      const adapter = make([{ id: 5, name: "Old", lightType: "onoff", onState: "a.on" }]);
      const ctx = mockContext({ form: { id: 99, name: "Renamed", lightType: "onoff", onState: "a.on" } });
      await internalOf(dm).editDevice("5", ctx);
      expect(adapter._stored()[0].id).toBe(5);
    });

    it("deletes on confirmation and keeps others", async () => {
      const adapter = make([
        { id: 1, name: "A", lightType: "onoff", onState: "a" },
        { id: 2, name: "B", lightType: "onoff", onState: "b" },
      ]);
      await internalOf(dm).deleteDevice("1", mockContext({ confirm: true }));
      expect(adapter._stored()).toEqual([{ id: 2, name: "B", lightType: "onoff", onState: "b" }]);
    });

    // v1.18.0 (audit 2026-09-15 A2): two lights on the same source shared the
    // card id — deleting the SECOND card removed the FIRST entry.
    it("deletes exactly the card clicked when two lights share a source", async () => {
      const adapter = make([
        { id: 1, name: "Bedroom", lightType: "dimmable", briState: "hm.LEVEL" },
        { id: 2, name: "Bedroom (alias)", lightType: "dimmable", briState: "hm.LEVEL" },
      ]);
      await internalOf(dm).deleteDevice("2", mockContext({ confirm: true }));
      expect(adapter._stored()).toEqual([{ id: 1, name: "Bedroom", lightType: "dimmable", briState: "hm.LEVEL" }]);
    });

    it("edit / delete on a card that is gone do nothing (list changed under the dialog)", async () => {
      // The Device-Manager list is a snapshot: the user can open the edit or
      // delete action on a row that another admin session (or the add-flow)
      // has meanwhile removed. Acting on it would rewrite or drop the WRONG
      // device — or write an `undefined` hole into native.devices.
      const adapterEdit = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      const editCtx = mockContext({ form: { name: "Ghost", lightType: "onoff", onState: "g" } });
      await internalOf(dm).editDevice("gone", editCtx);
      expect(editCtx.showForm).not.toHaveBeenCalled();
      expect(adapterEdit.extendForeignObjectAsync).not.toHaveBeenCalled();

      const adapterDel = make([{ name: "A", lightType: "onoff", onState: "a" }]);
      const delCtx = mockContext({ confirm: true });
      await internalOf(dm).deleteDevice("gone", delCtx);
      expect(delCtx.showConfirmation).not.toHaveBeenCalled();
      expect(adapterDel.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    // v1.17.0 (F10): the very case the positional id got wrong — another session
    // removed the FIRST light while this card was on screen.
    it("acts on the light the card names, even after the list shifted", async () => {
      const adapter = make([
        { id: 1, name: "A", lightType: "onoff", onState: "a" },
        { id: 2, name: "B", lightType: "onoff", onState: "b" },
      ]);
      // The card for "B" was rendered at position 1; by action time "A" is gone.
      adapter._setStored([{ id: 2, name: "B", lightType: "onoff", onState: "b" }]);
      await internalOf(dm).deleteDevice("2", mockContext({ confirm: true }));
      expect(adapter._stored()).toEqual([]);
    });

    it("does not delete when the confirmation is declined", async () => {
      const adapter = make([{ id: 1, name: "A", lightType: "onoff", onState: "a" }]);
      await internalOf(dm).deleteDevice("1", mockContext({ confirm: false }));
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
      expect(stored[0].id).toBe(1);
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
        [{ id: 1, name: "Flur", lightType: "dimmable", onState: "lampe.0.flur.on", briState: "lampe.0.flur.bri" }],
        objs,
      );
      const ctx = mockContext();
      await internalOf(dm).searchDevices(ctx);
      expect(ctx.showForm).not.toHaveBeenCalled(); // nothing fresh → no picker
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    // v1.18.0 (audit 2026-09-15 A1): the dedup keyed on the on/off state alone, so
    // a light without one — a dimmer exposing nothing but a level — was offered
    // and stored again on every scan.
    it("does not offer a light without an on/off state twice", async () => {
      const objs = channel("hm.0.dimmer", [["bri", "level.dimmer"]]);
      const adapter = make([{ id: 1, name: "Dimmer", lightType: "dimmable", briState: "hm.0.dimmer.bri" }], objs);
      const ctx = mockContext({ form: { sel_0: true } });
      await internalOf(dm).searchDevices(ctx);
      expect(ctx.showForm).not.toHaveBeenCalled();
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
      expect(adapter._stored()).toHaveLength(1);
    });

    it("does not offer a light that shares any bound state with a configured one", async () => {
      const objs = channel("lampe.0.flur", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
      ]);
      // Configured by hand with the level only; the scan sees on + level.
      const adapter = make([{ id: 1, name: "Flur", lightType: "dimmable", briState: "lampe.0.flur.bri" }], objs);
      const ctx = mockContext();
      await internalOf(dm).searchDevices(ctx);
      expect(ctx.showForm).not.toHaveBeenCalled();
      expect(adapter.extendForeignObjectAsync).not.toHaveBeenCalled();
    });

    it("numbers the added lights consecutively above the highest number in use", async () => {
      const objs = {
        ...channel("lampe.0.a", [["on", "switch.light", "boolean"]]),
        ...channel("lampe.0.b", [["on", "switch.light", "boolean"]]),
      };
      const adapter = make([{ id: 7, name: "Old", lightType: "onoff", onState: "x.on" }], objs);
      await internalOf(dm).searchDevices(mockContext({ form: { sel_0: true, sel_1: true } }));
      expect(adapter._stored().map((d: DeviceConfig) => d.id)).toEqual([7, 8, 9]);
    });

    // v1.18.0 (audit 2026-09-15 A3): `common.name` is a translation object on more
    // and more adapters — it used to fall through to the object id, and Alexa
    // learned "shelly.0.lamp" as the lamp's name.
    it("offers a light under its translated name in the system language", async () => {
      const objs = channel("shelly.0.lamp", [["on", "switch.light", "boolean"]]);
      (objs["shelly.0.lamp"].common as { name: unknown }).name = { en: "Lamp", de: "Lampe" };
      const adapter = make([], objs);
      adapter.language = "de";
      await internalOf(dm).searchDevices(mockContext({ form: { sel_0: true } }));
      expect(adapter._stored()[0].name).toBe("Lampe");
    });

    it("falls back to English, then to the id, for a translation object without the system language", async () => {
      const objsEn = channel("shelly.0.lamp", [["on", "switch.light", "boolean"]]);
      (objsEn["shelly.0.lamp"].common as { name: unknown }).name = { en: "Lamp" };
      const adapterEn = make([], objsEn);
      adapterEn.language = "de";
      await internalOf(dm).searchDevices(mockContext({ form: { sel_0: true } }));
      expect(adapterEn._stored()[0].name).toBe("Lamp");

      const objsNone = channel("shelly.0.lamp", [["on", "switch.light", "boolean"]]);
      (objsNone["shelly.0.lamp"].common as { name: unknown }).name = { fr: "Lampe" };
      const adapterNone = make([], objsNone);
      adapterNone.language = "de";
      await internalOf(dm).searchDevices(mockContext({ form: { sel_0: true } }));
      expect(adapterNone._stored()[0].name).toBe("shelly.0.lamp");
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

  /**
   * The registered handlers are what dm-utils calls. If one of them rejects,
   * dm-utils aborts `handleMessage` at the throw: the reply that closes the
   * action is never sent and the request's context is never cleaned up. So the
   * contract under test is "a handler always answers" — not "the action works".
   */
  describe("handler entry points always answer", () => {
    /**
     * Get one registered instance action handler by id.
     *
     * @param id The action id as registered in getInstanceInfo()
     */
    function instanceHandler(id: string): (ctx: MockCtx) => Promise<unknown> {
      const action = internalOf(dm)
        .getInstanceInfo()
        .actions?.find(a => a.id === id);
      if (!action) {
        throw new Error(`instance action "${id}" is not registered`);
      }
      return action.handler;
    }

    /**
     * Get one registered per-device action handler by id.
     *
     * @param id The action id as registered on the device card
     */
    function deviceHandler(id: string): (deviceId: string, ctx: MockCtx) => Promise<unknown> {
      const action = internalOf(dm)
        .toDeviceInfo({ name: "L", lightType: "onoff", onState: "a.on" }, 0)
        .actions?.find(a => a.id === id);
      if (!action) {
        throw new Error(`device action "${id}" is not registered`);
      }
      return action.handler;
    }

    /**
     * Make every config read fail, the way an unreachable objects DB would.
     *
     * @param adapter The mock adapter whose reads should fail
     * @param adapter.getForeignObjectAsync Its object-read mock
     */
    function breakConfigRead(adapter: { getForeignObjectAsync: ReturnType<typeof vi.fn> }): void {
      adapter.getForeignObjectAsync.mockRejectedValue(new Error("db down"));
    }

    it("add: reports the failure and still returns the refresh directive", async () => {
      const adapter = make([]);
      breakConfigRead(adapter);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "a.on" } });
      await expect(instanceHandler("add")(ctx)).resolves.toEqual({ refresh: true });
      expect(ctx.showMessage).toHaveBeenCalledWith({ key: "dmActionFailed", args: ["db down"] });
    });

    it("search: reports the failure and still returns the refresh directive", async () => {
      const adapter = make([]);
      // Break the progress dialog itself — that is ahead of searchDevices' own
      // try block, so only the handler guard can still answer here.
      adapter.getObjectViewAsync = vi.fn(() => Promise.reject(new Error("db down")));
      const ctx = mockContext();
      ctx.openProgress.mockRejectedValueOnce(new Error("gui gone"));
      await expect(instanceHandler("search")(ctx)).resolves.toEqual({ refresh: true });
      expect(ctx.showMessage).toHaveBeenCalledWith({ key: "dmActionFailed", args: ["gui gone"] });
    });

    it("edit: reports the failure and still returns the refresh directive", async () => {
      const adapter = make([{ name: "L", lightType: "onoff", onState: "a.on" }]);
      breakConfigRead(adapter);
      const ctx = mockContext({ form: { name: "L2", lightType: "onoff", onState: "a.on" } });
      await expect(deviceHandler("edit")("0", ctx)).resolves.toEqual({ refresh: "instance" });
      expect(ctx.showMessage).toHaveBeenCalledWith({ key: "dmActionFailed", args: ["db down"] });
    });

    it("delete: reports the failure and still returns the refresh directive", async () => {
      const adapter = make([{ name: "L", lightType: "onoff", onState: "a.on" }]);
      breakConfigRead(adapter);
      const ctx = mockContext();
      await expect(deviceHandler("delete")("0", ctx)).resolves.toEqual({ refresh: "instance" });
      expect(ctx.showMessage).toHaveBeenCalledWith({ key: "dmActionFailed", args: ["db down"] });
    });

    it("answers even when telling the user fails too", async () => {
      const adapter = make([]);
      breakConfigRead(adapter);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "a.on" } });
      ctx.showMessage.mockRejectedValue(new Error("gui gone"));
      await expect(instanceHandler("add")(ctx)).resolves.toEqual({ refresh: true });
      expect(adapter.log.warn).toHaveBeenCalled();
    });

    it("passes a successful action through untouched", async () => {
      const adapter = make([]);
      const ctx = mockContext({ form: { name: "New", lightType: "onoff", onState: "a.on" } });
      await expect(instanceHandler("add")(ctx)).resolves.toEqual({ refresh: true });
      expect(ctx.showMessage).not.toHaveBeenCalled();
      expect(adapter._stored()).toEqual([{ id: 1, name: "New", lightType: "onoff", onState: "a.on" }]);
    });

    it("loadDevices survives an unreadable config and adds no card", async () => {
      const adapter = make([{ name: "L", lightType: "onoff", onState: "a.on" }]);
      breakConfigRead(adapter);
      const ctx = { addDevice: vi.fn() };
      await expect(internalOf(dm).loadDevices(ctx)).resolves.toBeUndefined();
      expect(ctx.addDevice).not.toHaveBeenCalled();
      expect(adapter.log.warn).toHaveBeenCalled();
    });
  });
});
