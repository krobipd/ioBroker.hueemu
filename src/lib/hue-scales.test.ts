/**
 * Tests for `lib/hue-scales.ts` — every Hue value range, both conversion
 * directions, the derivation from a bound object's `common`, and the relative
 * attributes. Split out of `device-scan.test.ts` and
 * `device-binding-service.test.ts` in v1.17.0, when the unit knowledge moved
 * into one module.
 */

import {
  clampScaleForState,
  convertValueForState,
  ctForState,
  ctFromState,
  convertValueFromState,
  deriveCtScale,
  deriveHueScale,
  deriveLevelScale,
  fitToTarget,
  getDefaultValue,
  applyIncrement,
  isUndecidedScale,
  scaleValueForState,
  scaleValueFromState,
  stateFactsOf,
  type ScaledDevice,
  type StateFacts,
} from "./hue-scales";
import type { Logger } from "../types/config";

const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * Build a minimal state object for the fact reader.
 *
 * @param id The object id.
 * @param role The state role.
 * @param type The state type.
 * @param extras Extra `common` fields.
 * @param extras.write Whether the state declares itself writable.
 * @param extras.min The declared minimum.
 * @param extras.max The declared maximum.
 * @param extras.unit The declared unit.
 */
function state(
  id: string,
  role: string,
  type: string,
  extras: { write?: boolean; min?: number; max?: number; unit?: string } = {},
): Record<string, ioBroker.Object> {
  return {
    [id]: {
      _id: id,
      type: "state",
      common: { name: id, role, type, read: true, write: true, ...extras },
      native: {},
    } as unknown as ioBroker.Object,
  };
}

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
  });

  // v1.19.0 (audit 2026-09-25 Q13): a 0..255 source was taken as Hue-native and
  // never reached its own 255 — full brightness stopped one step short.
  it("reads a 0..255 brightness as byte, not as Hue-native", () => {
    expect(deriveLevelScale({ writable: true, min: 0, max: 255 })).toBe("byte");
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

  // v1.19.0 (audit 2026-09-25 K4): ioBroker.tradfri's colorTemperature is 0..100 %
  // ("0% = cold, 100% = warm") — it was read and written as mired.
  it("reads a colour temperature in percent from the unit", () => {
    expect(deriveCtScale({ writable: true, min: 0, max: 100, unit: "%" })).toBe("percent");
    // The range alone proves nothing — only the unit counts.
    expect(deriveCtScale({ writable: true, min: 0, max: 100 })).toBeUndefined();
  });
});

describe("colour temperature scales", () => {
  it("maps percent linearly across Hue's range, 0 % = coldest", () => {
    expect(ctFromState(0, "percent")).toBe(153);
    expect(ctFromState(100, "percent")).toBe(500);
    expect(ctFromState(50, "percent")).toBe(327);
    expect(ctFromState(150, "percent")).toBe(500);
    expect(ctFromState(-5, "percent")).toBe(153);
  });

  it("writes percent back, and round-trips", () => {
    expect(ctForState(153, "percent")).toBe(0);
    expect(ctForState(500, "percent")).toBe(100);
    expect(ctForState(327, "percent")).toBe(50);
    for (let pct = 0; pct <= 100; pct++) {
      expect(ctForState(ctFromState(pct, "percent"), "percent")).toBe(pct);
    }
  });

  it("keeps kelvin and mired as they were", () => {
    expect(ctFromState(4000, "kelvin")).toBe(250);
    expect(ctForState(250, "kelvin")).toBe(4000);
    expect(ctFromState(300, undefined)).toBe(300);
    expect(ctForState(300, "raw")).toBe(300);
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
    expect(facts).toEqual({ writable: true, min: 0, max: 360, unit: "°", type: "number" });
  });
});

describe("isUndecidedScale", () => {
  it("treats absent, empty and the explicit auto as undecided", () => {
    expect(isUndecidedScale(undefined)).toBe(true);
    expect(isUndecidedScale("")).toBe(true);
    expect(isUndecidedScale("auto")).toBe(true);
  });

  it("treats a real choice as decided", () => {
    expect(isUndecidedScale("percent")).toBe(false);
    expect(isUndecidedScale("normalized")).toBe(false);
    expect(isUndecidedScale("raw")).toBe(false);
    expect(isUndecidedScale("kelvin")).toBe(false);
    expect(isUndecidedScale("degrees")).toBe(false);
  });
});

describe("percent-style scales, read direction", () => {
  it("maps the declared scales", () => {
    expect(scaleValueFromState(50, "percent", 1, 254, logger)).toBe(127);
    expect(scaleValueFromState(0.5, "normalized", 1, 254, logger)).toBe(127);
    expect(scaleValueFromState(127, "raw", 1, 254, logger)).toBe(127);
    expect(scaleValueFromState(255, "byte", 1, 254, logger)).toBe(254);
    expect(scaleValueFromState(128, "byte", 1, 254, logger)).toBe(127); // 128/255 × 254 = 127.498
  });

  it("falls back to the heuristic when nothing is decided", () => {
    expect(scaleValueFromState(0.5, undefined, 1, 254, logger)).toBe(127);
    expect(scaleValueFromState(50, "auto", 1, 254, logger)).toBe(127);
    expect(scaleValueFromState(200, "auto", 1, 254, logger)).toBe(200);
  });

  it("returns the maximum for a value it cannot read", () => {
    expect(scaleValueFromState("nonsense", "percent", 1, 254, logger)).toBe(254);
    expect(scaleValueFromState(null, undefined, 1, 254, logger)).toBe(254);
  });
});

describe("percent-style scales, write direction", () => {
  it("inverts every declared scale", () => {
    expect(scaleValueForState(254, "percent", 254)).toBe(100);
    expect(scaleValueForState(127, "percent", 254)).toBe(50);
    expect(scaleValueForState(127, "normalized", 254)).toBe(0.5);
    expect(scaleValueForState(127, "raw", 254)).toBe(127);
    // Byte reaches its own full scale.
    expect(scaleValueForState(254, "byte", 254)).toBe(255);
    expect(scaleValueForState(1, "byte", 254)).toBe(1);
  });

  // v1.17.0 (audit 2026-09-06 F1): the undecided scale used to write the raw Hue
  // number while READING through the heuristic, so a 0..100 % source ended up
  // holding 127. Both directions have to agree.
  it("mirrors the read heuristic using the source's own last value", () => {
    expect(scaleValueForState(127, "auto", 254, 50)).toBe(50); // source reads 0..100
    expect(scaleValueForState(127, undefined, 254, 0.5)).toBe(0.5); // source reads 0..1
    expect(scaleValueForState(127, "auto", 254, 200)).toBe(127); // source is Hue-native
  });

  it("stays Hue-native when the source has said nothing yet", () => {
    expect(scaleValueForState(127, "auto", 254, undefined)).toBe(127);
    expect(scaleValueForState(127, "auto", 254, "nonsense")).toBe(127);
  });

  it("does not read a zero as the 0..1 branch — every scale has a zero", () => {
    expect(scaleValueForState(127, "auto", 254, 0)).toBe(127);
  });

  // v1.19.0 (audit 2026-09-25 H6): the percent branch writes whole percents and never
  // below 2 for a lit lamp — 1 and less read back as the 0..1 branch and flipped the scale.
  it("writes a lit lamp as at least 2 % so the value cannot read back as 0..1", () => {
    expect(scaleValueForState(1, "auto", 254, 50)).toBe(2);
    expect(scaleValueForState(3, "auto", 254, 50)).toBe(2);
    expect(scaleValueForState(254, "auto", 254, 50)).toBe(100);
    expect(scaleValueForState(0, "auto", 254, 50)).toBe(0);
  });

  it("round-trips a percent source through both directions", () => {
    const hue = scaleValueFromState(50, "auto", 1, 254, logger);
    expect(scaleValueForState(hue, "auto", 254, 50)).toBe(50);
  });
});

describe("clampScaleForState", () => {
  it("clamps into the Hue range before scaling back", () => {
    expect(clampScaleForState(9999, 1, 254, "percent", logger)).toBe(100);
    expect(clampScaleForState(-5, 1, 254, "percent", logger)).toBe(0.4);
  });

  it("skips the write for a value it cannot read", () => {
    expect(clampScaleForState("abc", 1, 254, "percent", logger)).toBeUndefined();
    expect(clampScaleForState({}, 1, 254, undefined, logger)).toBeUndefined();
  });
});

describe("attribute conversion", () => {
  const device: ScaledDevice = { name: "L", briScale: "percent", hueScale: "degrees", ctScale: "kelvin" };

  it("reads every attribute into Hue space", () => {
    expect(convertValueFromState("on", "yes", device, logger)).toBe(true);
    expect(convertValueFromState("bri", 50, device, logger)).toBe(127);
    expect(convertValueFromState("hue", 180, device, logger)).toBe(32768);
    expect(convertValueFromState("ct", 4000, device, logger)).toBe(250);
    expect(convertValueFromState("xy", "[0.3,0.4]", device, logger)).toEqual([0.3, 0.4]);
    expect(convertValueFromState("xy", "0.3, 0.4", device, logger)).toEqual([0.3, 0.4]);
  });

  it("writes every attribute back into the source scale", () => {
    expect(convertValueForState("on", true, device, logger)).toBe(true);
    expect(convertValueForState("bri", 127, device, logger)).toBe(50);
    expect(convertValueForState("hue", 32768, device, logger)).toBe(180);
    expect(convertValueForState("ct", 250, device, logger)).toBe(4000);
    expect(convertValueForState("xy", [0.3, 0.4], device, logger)).toBe("[0.3,0.4]");
  });

  it("returns the documented default for an unset value", () => {
    expect(convertValueFromState("bri", null, device, logger)).toBe(254);
    expect(convertValueFromState("xy", undefined, device, logger)).toEqual([0.5, 0.5]);
    expect(getDefaultValue("ct")).toBe(250);
    expect(getDefaultValue("nonsense")).toBeNull();
  });

  it("passes an unknown attribute through untouched in both directions", () => {
    // `transitiontime`, `effect`, `alert` — accepted, acknowledged, not scaled.
    expect(convertValueFromState("transitiontime", 4, device, logger)).toBe(4);
    expect(convertValueForState("effect", "colorloop", device, logger)).toBe("colorloop");
    expect(convertValueForState("alert", null, device, logger)).toBeNull();
    // An object has no place in a foreign state — serialise rather than write "[object Object]".
    expect(convertValueForState("unknown", { a: 1 }, device, logger)).toBe('{"a":1}');
  });

  it("skips a write it cannot make sense of instead of inventing one", () => {
    expect(convertValueForState("bri", "abc", device, logger)).toBeUndefined();
    expect(convertValueForState("hue", {}, device, logger)).toBeUndefined();
    expect(convertValueForState("ct", null, device, logger)).toBeUndefined();
    expect(convertValueForState("xy", 5, device, logger)).toBeUndefined();
  });
});

describe("applyIncrement", () => {
  it("has no answer for an attribute that has no relative form", () => {
    expect(applyIncrement("effect", 1, 1)).toBeUndefined();
    expect(applyIncrement("on", true, 1)).toBeUndefined();
  });
});

// v1.19.0 (audit 2026-09-25 H9, decision E8): a write is shaped the way the target
// declares it — js-controller writes whatever it gets and only warns.
describe("fitToTarget", () => {
  it("writes as converted when nothing is known about the target", () => {
    expect(fitToTarget(6536, undefined)).toEqual({ write: true, value: 6536 });
  });

  it("clamps a number to the declared bounds", () => {
    const facts: StateFacts = { writable: true, min: 1700, max: 6500 };
    expect(fitToTarget(6536, facts)).toEqual({ write: true, value: 6500 });
    expect(fitToTarget(1000, facts)).toEqual({ write: true, value: 1700 });
    expect(fitToTarget(4000, facts)).toEqual({ write: true, value: 4000 });
  });

  it("writes nothing into a read-only datapoint", () => {
    expect(fitToTarget(true, { writable: false })).toEqual({ write: false, value: true });
  });

  it("gives a text switch its own on/off keys", () => {
    const mqtt: StateFacts = { writable: true, type: "string", states: { ON: "On", OFF: "Off" } };
    expect(fitToTarget(true, mqtt)).toEqual({ write: true, value: "ON" });
    expect(fitToTarget(false, mqtt)).toEqual({ write: true, value: "OFF" });
    const words: StateFacts = { writable: true, type: "string", states: { an: "An", aus: "Aus" } };
    expect(fitToTarget(false, words)).toEqual({ write: true, value: "aus" });
  });

  it("invents no text: a string target without an on/off pair keeps the boolean", () => {
    expect(fitToTarget(true, { writable: true, type: "string" })).toEqual({ write: true, value: true });
    expect(fitToTarget(true, { writable: true, type: "string", states: { a: "A" } })).toEqual({
      write: true,
      value: true,
    });
  });

  it("reads type and states from the object", () => {
    const obj = {
      _id: "m",
      type: "state",
      common: { name: "m", type: "string", role: "switch", read: true, write: true, states: { ON: "On", OFF: "Off" } },
      native: {},
    } as unknown as ioBroker.Object;
    expect(stateFactsOf(obj)).toMatchObject({ type: "string", states: { ON: "On", OFF: "Off" } });
  });
});
