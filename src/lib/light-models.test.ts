import LIGHT_MODELS from "./light-models.json";

describe("light-models.json", () => {
  it("names exactly one Hue model for each of the four light types", () => {
    expect(Object.values(LIGHT_MODELS.models).sort()).toEqual(["color", "ct", "dimmable", "onoff"]);
  });
});
