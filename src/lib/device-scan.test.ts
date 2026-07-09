/**
 * Tests for the light-device discovery mapping. Uses the REAL
 * @iobroker/type-detector (not a mock) over sample object trees, so the
 * detector-type → hueemu-DeviceConfig mapping is proven against the library's
 * actual output, and drifts if the detector changes its patterns.
 */

import { scanForLightDevices, mapControlToDevice } from "./device-scan";

/** Build a state object with a role. */
function state(id: string, role: string, type: ioBroker.CommonType = "number"): Record<string, ioBroker.Object> {
  return {
    [id]: { _id: id, type: "state", common: { role, type, read: true, write: true, name: id }, native: {} } as ioBroker.Object,
  };
}

/** Build a channel device with the given `[suffix, role]` state children. */
function channel(prefix: string, states: [string, string, ioBroker.CommonType?][]): Record<string, ioBroker.Object> {
  let objs: Record<string, ioBroker.Object> = {
    [prefix]: { _id: prefix, type: "channel", common: { role: "light", name: prefix }, native: {} } as ioBroker.Object,
  };
  for (const [suf, role, t] of states) {
    objs = { ...objs, ...state(`${prefix}.${suf}`, role, t) };
  }
  return objs;
}

const nameOf = (_id: string, obj: ioBroker.Object): string => (obj.common.name as string) || _id;

describe("scanForLightDevices", () => {
  it("maps an on/off light → onoff", () => {
    const { devices } = scanForLightDevices(channel("x.0.onoff", [["on", "switch.light", "boolean"]]), nameOf);
    expect(devices).toEqual([{ name: "x.0.onoff", lightType: "onoff", onState: "x.0.onoff.on" }]);
  });

  it("maps a dimmer → dimmable (on + bri)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.dim", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"]]),
      nameOf,
    );
    expect(devices).toEqual([{ name: "x.0.dim", lightType: "dimmable", onState: "x.0.dim.on", briState: "x.0.dim.bri" }]);
  });

  it("maps a colour-temperature light → ct (on + bri + ct)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.ct", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"], ["ct", "level.color.temperature"]]),
      nameOf,
    );
    expect(devices[0]).toMatchObject({ lightType: "ct", onState: "x.0.ct.on", briState: "x.0.ct.bri", ctState: "x.0.ct.ct" });
  });

  it("maps a hue/sat colour light → color (on + bri + hue + sat)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.hs", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
        ["hue", "level.color.hue"],
        ["sat", "level.color.saturation"],
      ]),
      nameOf,
    );
    expect(devices[0]).toMatchObject({
      lightType: "color",
      onState: "x.0.hs.on",
      briState: "x.0.hs.bri",
      hueState: "x.0.hs.hue",
      satState: "x.0.hs.sat",
    });
  });

  it("maps an xy/cie colour light → color (xy)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.cie", [["on", "switch.light", "boolean"], ["bri", "level.dimmer"], ["cie", "level.color.cie", "string"]]),
      nameOf,
    );
    expect(devices[0]).toMatchObject({ lightType: "color", onState: "x.0.cie.on", xyState: "x.0.cie.cie" });
  });

  it("reports an RGB-channel device as unmapped (no hue/sat/xy slot), not silently dropped", () => {
    const { devices, unmapped } = scanForLightDevices(
      channel("x.0.rgb", [
        ["on", "switch.light", "boolean"],
        ["red", "level.color.red"],
        ["green", "level.color.green"],
        ["blue", "level.color.blue"],
      ]),
      nameOf,
    );
    expect(devices).toEqual([]);
    expect(unmapped.map(u => u.type)).toContain("rgb");
  });

  it("ignores non-light objects", () => {
    const objs = state("x.0.temp", "value.temperature");
    expect(scanForLightDevices(objs, nameOf)).toEqual({ devices: [], unmapped: [] });
  });

  it("uses the device display name from the object", () => {
    const objs = channel("x.0.lamp", [["on", "switch.light", "boolean"]]);
    objs["x.0.lamp"].common.name = "Living Room";
    expect(scanForLightDevices(objs, nameOf).devices[0].name).toBe("Living Room");
  });
});

describe("mapControlToDevice", () => {
  it("returns null for a control without an on/off state", () => {
    expect(mapControlToDevice("dimmer", [{ name: "SET", id: "x.bri" }], "x")).toBeNull();
  });

  it("returns null for an rgb control type", () => {
    expect(mapControlToDevice("rgb", [{ name: "RED", id: "x.r" }], "x")).toBeNull();
  });
});
