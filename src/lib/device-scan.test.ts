/**
 * Tests for the light-device discovery mapping. Uses the REAL
 * `@iobroker/type-detector` (not a mock) over sample object trees, so the
 * detector-type → hueemu-DeviceConfig mapping is proven against the library's
 * actual output, and drifts if the detector changes its patterns.
 *
 * The v1.15.0 block at the bottom reproduces the four shapes the 2026-09-03
 * audit measured on real hardware (zigbee colour bulb, HomeMatic HmIP-BDT
 * dimmer channel) — those are the regressions that must never come back.
 */

import {
  scanForLightDevices,
  mapControlToDevice,
  deriveLevelScale,
  deriveHueScale,
  deriveCtScale,
  stateFactsOf,
  type StateFacts,
  type StateLookup,
} from "./device-scan";

/** Extra `common` fields a sample state may declare. */
interface StateExtras {
  write?: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

/**
 * Build a state object with a role.
 *
 * @param id The full state id
 * @param role The common.role of the state
 * @param type The common.type of the state (default number)
 * @param extras Optional write flag / bounds / unit, as a real adapter declares them
 */
function state(
  id: string,
  role: string,
  type: ioBroker.CommonType = "number",
  extras: StateExtras = {},
): Record<string, ioBroker.Object> {
  return {
    [id]: {
      _id: id,
      type: "state",
      common: { role, type, read: true, write: extras.write ?? true, name: id, ...extras },
      native: {},
    },
  };
}

/** A state child of a sample channel: `[suffix, role, type?, extras?]`. */
type ChannelState = [string, string, ioBroker.CommonType?, StateExtras?];

/**
 * Build a channel device with the given state children.
 *
 * @param prefix The channel id (device prefix of the state ids)
 * @param states `[suffix, role, type?, extras?]` tuples for the state children
 */
function channel(prefix: string, states: ChannelState[]): Record<string, ioBroker.Object> {
  let objs: Record<string, ioBroker.Object> = {
    [prefix]: { _id: prefix, type: "channel", common: { role: "light", name: prefix }, native: {} },
  };
  for (const [suf, role, t, extras] of states) {
    objs = { ...objs, ...state(`${prefix}.${suf}`, role, t, extras) };
  }
  return objs;
}

const nameOf = (_id: string, obj: ioBroker.Object): string => (obj.common.name as string) || _id;

/** A lookup that treats every id as a plain writable state with no bounds. */
const anyWritable: StateLookup = () => ({ writable: true });

describe("scanForLightDevices", () => {
  it("maps an on/off light → onoff", () => {
    const { devices } = scanForLightDevices(channel("x.0.onoff", [["on", "switch.light", "boolean"]]), nameOf);
    expect(devices).toEqual([{ name: "x.0.onoff", lightType: "onoff", onState: "x.0.onoff.on" }]);
  });

  it("maps a dimmer → dimmable (on + bri)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.dim", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
      ]),
      nameOf,
    );
    expect(devices).toEqual([
      { name: "x.0.dim", lightType: "dimmable", onState: "x.0.dim.on", briState: "x.0.dim.bri" },
    ]);
  });

  it("maps a colour-temperature light → ct (on + bri + ct)", () => {
    const { devices } = scanForLightDevices(
      channel("x.0.ct", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
        ["ct", "level.color.temperature"],
      ]),
      nameOf,
    );
    expect(devices[0]).toMatchObject({
      lightType: "ct",
      onState: "x.0.ct.on",
      briState: "x.0.ct.bri",
      ctState: "x.0.ct.ct",
    });
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
      channel("x.0.cie", [
        ["on", "switch.light", "boolean"],
        ["bri", "level.dimmer"],
        ["cie", "level.color.cie", "string"],
      ]),
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
    expect(unmapped.every(u => u.reason === "rgbChannel")).toBe(true);
  });

  it("ignores non-light objects", () => {
    const objs = state("x.0.temp", "value.temperature");
    expect(scanForLightDevices(objs, nameOf)).toEqual({ devices: [], unmapped: [] });
  });

  it("does not turn a socket into a light", () => {
    // A socket is detected as its own control type but carries an on/off state,
    // so without the light-type filter every power plug in the system would show
    // up as a Hue light — and the pairing list would be unusable.
    const objs = channel("x.0.plug", [["state", "switch", "boolean"]]);
    objs["x.0.plug"].common.role = "socket";
    const { devices } = scanForLightDevices(objs, nameOf);
    expect(devices).toEqual([]);
  });

  it("uses the device display name from the object", () => {
    const objs = channel("x.0.lamp", [["on", "switch.light", "boolean"]]);
    objs["x.0.lamp"].common.name = "Living Room";
    expect(scanForLightDevices(objs, nameOf).devices[0].name).toBe("Living Room");
  });
});

describe("mapControlToDevice", () => {
  it("reports a control with nothing writable to drive, instead of dropping it", () => {
    const outcome = mapControlToDevice("ct", [{ name: "TEMPERATURE", id: "x.ct" }], "x", anyWritable);
    expect(outcome).toEqual({ kind: "unmapped", reason: "noWritableTarget" });
  });

  it("maps a dimmer that has only a brightness state — brightness carries on/off", () => {
    const outcome = mapControlToDevice("dimmer", [{ name: "SET", id: "x.bri" }], "x", anyWritable);
    expect(outcome).toEqual({
      kind: "device",
      device: { name: "x", lightType: "dimmable", onState: undefined, briState: "x.bri" },
    });
  });

  it("reports an rgb control type as an RGB channel", () => {
    expect(mapControlToDevice("rgb", [{ name: "RED", id: "x.r" }], "x", anyWritable)).toEqual({
      kind: "unmapped",
      reason: "rgbChannel",
    });
  });

  it("binds the FIRST state of a pattern — the detector lists the primary one first", () => {
    // A control can carry the same pattern twice (a writable setpoint plus a
    // read-only actual). Taking the last one would bind the emulator to the
    // read-back value: the Hue client shows a light that never switches.
    const outcome = mapControlToDevice(
      "dimmer",
      [
        { name: "ON_SET", id: "x.on" },
        { name: "ON_SET", id: "x.on_actual" },
        { name: "DIMMER", id: "x.bri" },
        { name: "DIMMER", id: "x.bri_actual" },
      ],
      "x",
      anyWritable,
    );
    expect(outcome).toEqual({
      kind: "device",
      device: { name: "x", lightType: "dimmable", onState: "x.on", briState: "x.bri" },
    });
  });

  it("never binds a read-only state as the switch", () => {
    // ON_ACTUAL is `write: false` in every light pattern of the detector — a
    // status mirror. Binding it produced a light that could never be switched.
    const lookup: StateLookup = id => ({ writable: id !== "x.status" });
    const outcome = mapControlToDevice(
      "dimmer",
      [
        { name: "ON_ACTUAL", id: "x.status" },
        { name: "SET", id: "x.bri" },
      ],
      "x",
      lookup,
    );
    expect(outcome).toMatchObject({ kind: "device", device: { onState: undefined, briState: "x.bri" } });
  });

  it("maps the colour temperature of a hue-type light (it has a ct slot)", () => {
    const outcome = mapControlToDevice(
      "hue",
      [
        { name: "ON", id: "x.on" },
        { name: "HUE", id: "x.hue" },
        { name: "SATURATION", id: "x.sat" },
        { name: "TEMPERATURE", id: "x.ct" },
      ],
      "x",
      anyWritable,
    );
    expect(outcome).toMatchObject({ kind: "device", device: { ctState: "x.ct" } });
  });

  it("treats an unknown object as unusable — we cannot tell whether writing does anything", () => {
    const outcome = mapControlToDevice("dimmer", [{ name: "SET", id: "x.bri" }], "x", () => undefined);
    expect(outcome).toEqual({ kind: "unmapped", reason: "noWritableTarget" });
  });
});

describe("scale derivation", () => {
  it("has no opinion without evidence", () => {
    expect(deriveLevelScale({ writable: true })).toBeUndefined();
    expect(deriveHueScale({ writable: true })).toBeUndefined();
    expect(deriveCtScale({ writable: true })).toBeUndefined();
    expect(deriveLevelScale(undefined)).toBeUndefined();
    expect(deriveHueScale(undefined)).toBeUndefined();
    expect(deriveCtScale(undefined)).toBeUndefined();
  });

  it("reads a percent brightness from the unit and from the bounds", () => {
    expect(deriveLevelScale({ writable: true, unit: "%" })).toBe("percent");
    expect(deriveLevelScale({ writable: true, min: 0, max: 100 })).toBe("percent");
  });

  it("tolerates a bound that is a hair off the round number", () => {
    // HomeMatic stores 1.01 as the native max of a 0..100 level.
    expect(deriveLevelScale({ writable: true, max: 100.4 })).toBe("percent");
    expect(deriveLevelScale({ writable: true, max: 1.01 })).toBe("normalized");
  });

  it("reads a normalized and a Hue-native brightness", () => {
    expect(deriveLevelScale({ writable: true, min: 0, max: 1 })).toBe("normalized");
    expect(deriveLevelScale({ writable: true, min: 0, max: 254 })).toBe("raw");
    expect(deriveLevelScale({ writable: true, min: 0, max: 255 })).toBe("raw");
  });

  it("reads a hue in degrees and a Hue-native one", () => {
    expect(deriveHueScale({ writable: true, min: 0, max: 360 })).toBe("degrees");
    expect(deriveHueScale({ writable: true, unit: "°" })).toBe("degrees");
    expect(deriveHueScale({ writable: true, max: 65535 })).toBe("raw");
  });

  it("reads a colour temperature in Kelvin from the unit or a plausible range", () => {
    expect(deriveCtScale({ writable: true, unit: "°K" })).toBe("kelvin");
    expect(deriveCtScale({ writable: true, unit: "K" })).toBe("kelvin");
    expect(deriveCtScale({ writable: true, unit: "Kelvin" })).toBe("kelvin");
    expect(deriveCtScale({ writable: true, min: 2000, max: 6500 })).toBe("kelvin");
  });

  it("leaves a bare colour temperature alone — the zigbee adapter reports mired", () => {
    // The live zigbee `colortemp` carries neither unit nor bounds while the
    // detector's pattern claims °K. Deriving from the role would have turned a
    // correct binding into a wrong one (2026-09-03 audit).
    expect(deriveCtScale({ writable: true })).toBeUndefined();
    expect(deriveCtScale({ writable: true, unit: "mired" })).toBe("raw");
  });
});

describe("stateFactsOf", () => {
  it("treats a missing write flag as writable — plenty of adapters omit it", () => {
    const obj = { _id: "x", type: "state", common: { name: "x", type: "number", role: "level" }, native: {} };
    expect(stateFactsOf(obj as ioBroker.Object)).toMatchObject({ writable: true });
  });

  it("only an explicit false disqualifies", () => {
    const obj = state("x", "level", "number", { write: false }).x;
    expect(stateFactsOf(obj)?.writable).toBe(false);
  });

  it("has no facts for a non-state object or a missing one", () => {
    const obj = { _id: "x", type: "channel", common: { name: "x" }, native: {} };
    expect(stateFactsOf(obj as ioBroker.Object)).toBeUndefined();
    expect(stateFactsOf(undefined)).toBeUndefined();
    expect(stateFactsOf(null)).toBeUndefined();
  });

  it("passes bounds and unit through, ignoring non-numeric ones", () => {
    const facts = stateFactsOf(state("x", "level", "number", { min: 0, max: 360, unit: "°" }).x) as StateFacts;
    expect(facts).toEqual({ writable: true, min: 0, max: 360, unit: "°" });
  });
});

describe("v1.15.0 regressions — shapes measured on real hardware (2026-09-03 audit)", () => {
  it("a zigbee colour bulb gets every provable scale AND its colour temperature", () => {
    // zigbee.0.<id>: hue 0..360, saturation 0..100, brightness 0..100,
    // colortemp with neither unit nor bounds (it is mired).
    const objs: Record<string, ioBroker.Object> = {
      "zigbee.0.bulb": { _id: "zigbee.0.bulb", type: "device", common: { name: "Kitchen" }, native: {} },
      ...state("zigbee.0.bulb.state", "switch.light", "boolean"),
      ...state("zigbee.0.bulb.brightness", "level.dimmer", "number", { min: 0, max: 100 }),
      ...state("zigbee.0.bulb.hue", "level.color.hue", "number", { min: 0, max: 360 }),
      ...state("zigbee.0.bulb.saturation", "level.color.saturation", "number", { min: 0, max: 100 }),
      ...state("zigbee.0.bulb.colortemp", "level.color.temperature", "number"),
    };
    const { devices } = scanForLightDevices(objs, nameOf);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      name: "Kitchen",
      lightType: "color",
      onState: "zigbee.0.bulb.state",
      briState: "zigbee.0.bulb.brightness",
      briScale: "percent",
      hueState: "zigbee.0.bulb.hue",
      hueScale: "degrees",
      satState: "zigbee.0.bulb.saturation",
      satScale: "percent",
      // Mapped at last — an unmapped ct made every scanned colour light report
      // the 250-mired placeholder for ever.
      ctState: "zigbee.0.bulb.colortemp",
      // …and deliberately WITHOUT a ctScale: the source proves nothing, and the
      // adapter's mired default is what this adapter actually delivers.
    });
    expect(devices[0].ctScale).toBeUndefined();
  });

  it("a HomeMatic dimmer channel without any switch becomes a usable light", () => {
    // HmIP-BDT, channel type DIMMER_VIRTUAL_RECEIVER: LEVEL and nothing boolean.
    const objs: Record<string, ioBroker.Object> = {
      "hm-rpc.1.ABC.4": { _id: "hm-rpc.1.ABC.4", type: "channel", common: { name: "Bedroom" }, native: {} },
      ...state("hm-rpc.1.ABC.4.LEVEL", "level.dimmer", "number", { min: 0, max: 100, unit: "%" }),
      ...state("hm-rpc.1.ABC.4.LEVEL_STATUS", "", "number", { write: false, min: 0, max: 4 }),
    };
    const { devices, unmapped } = scanForLightDevices(objs, nameOf);
    expect(unmapped).toEqual([]);
    expect(devices).toEqual([
      {
        name: "Bedroom",
        lightType: "dimmable",
        onState: undefined,
        briState: "hm-rpc.1.ABC.4.LEVEL",
        briScale: "percent",
      },
    ]);
  });

  it("a light whose only on/off candidate is read-only is not bound to that mirror", () => {
    const objs = channel("knx.0.dim", [
      ["level", "level.dimmer", "number", { min: 0, max: 100, unit: "%" }],
      ["status", "sensor.light", "boolean", { write: false }],
    ]);
    const { devices } = scanForLightDevices(objs, nameOf);
    expect(devices).toHaveLength(1);
    expect(devices[0].onState).toBeUndefined();
    expect(devices[0].briState).toBe("knx.0.dim.level");
  });
});
