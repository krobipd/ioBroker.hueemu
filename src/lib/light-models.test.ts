import LIGHT_MODELS from "./light-models.json";

describe("light-models.json", () => {
  it("names exactly one Hue model for each of the four light types", () => {
    expect(Object.values(LIGHT_MODELS.models).sort()).toEqual(["color", "ct", "dimmable", "onoff"]);
  });

  // Gate A15 holds the types against diyHue's light types (device-sources.json): every light type answers with
  // exactly one Hue v1 type.
  it("names exactly one Hue v1 type for each of the four light types", () => {
    expect(Object.values(LIGHT_MODELS.types).flat().sort()).toEqual(["color", "ct", "dimmable", "onoff"]);
  });
});
