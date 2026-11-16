import LIGHT_MODELS from "./light-models.json";

describe("light-models.json", () => {
  it("names exactly one Hue model for each of the five light types", () => {
    expect(Object.values(LIGHT_MODELS.models).sort()).toEqual(["color", "colorOnly", "ct", "dimmable", "onoff"]);
  });

  // Gate A15 holds the types against diyHue's light types (device-sources.json): every light type answers with
  // exactly one Hue v1 type.
  it("names exactly one Hue v1 type for each of the five light types", () => {
    const lines = Object.values(LIGHT_MODELS.types).filter((v): v is string[] => Array.isArray(v));
    expect(lines.flat().sort()).toEqual(["color", "colorOnly", "ct", "dimmable", "onoff"]);
  });

  // A source's other name for a light type hueemu carries stands at that type (A15 fix text, round 179).
  it("points every other name of a source at a type the bridge answers with", () => {
    const others = Object.entries(LIGHT_MODELS.types).filter((e): e is [string, string] => typeof e[1] === "string");
    expect(others).toEqual([["Color Gamut light", "Color light"]]);
    for (const [, type] of others) {
      expect(Array.isArray((LIGHT_MODELS.types as Record<string, unknown>)[type])).toBe(true);
    }
  });
});
