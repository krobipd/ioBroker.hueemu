/**
 * Tests for DeviceBindingService — value conversions, light management, state setting
 */

import { HueApiError, HueErrorType } from "../types/errors";
import { DeviceBindingService, type DeviceConfig } from "./device-binding-service";
import { createMockDeviceBindingAdapter, createMockLogger } from "../../test/test-helpers";
import type { Logger } from "../types/config";

// Helper to create service with test devices
function createService(devices: DeviceConfig[], stateValues: Record<string, unknown> = {}) {
  const adapter = createMockDeviceBindingAdapter(stateValues);
  const logger = createMockLogger();
  const service = new DeviceBindingService({
    adapter,
    devices,
    logger,
  });
  return { service, adapter };
}

// Logger whose methods are vi spies, for asserting init-time diagnostics.
function spyLogger(): Logger & { warn: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger & {
    warn: ReturnType<typeof vi.fn>;
  };
}

describe("DeviceBindingService", () => {
  describe("getAllLights", () => {
    it("should return empty collection for no devices", async () => {
      const { service } = createService([]);
      const lights = await service.getAllLights();
      expect(lights).toEqual({});
    });

    it("should return lights with 1-based IDs", async () => {
      const { service } = createService([
        { name: "First", lightType: "onoff" },
        { name: "Second", lightType: "dimmable" },
      ]);
      const lights = await service.getAllLights();
      expect(Object.keys(lights)).toEqual(["1", "2"]);
      expect(lights["1"].name).toBe("First");
      expect(lights["2"].name).toBe("Second");
    });
  });

  describe("getLightById", () => {
    it("should throw for invalid light ID (0)", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("0");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
        expect((error as HueApiError).type).toBe(HueErrorType.RESOURCE_NOT_AVAILABLE);
      }
    });

    it("should throw for out-of-range light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("5");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
      }
    });

    it("should throw for negative light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("-1");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
      }
    });

    // E1 v1.4.3 — earlier `parseInt("abc")` gave NaN, NaN-comparisons fall
    // through both bound checks, code accessed `devices[NaN]` and crashed
    // with TypeError several lines later. Now bad ids surface as Hue 404
    // at the boundary.
    it("should throw resourceNotAvailable for non-numeric light ID (E1 v1.4.3)", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("abc");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
        expect((error as HueApiError).type).toBe(HueErrorType.RESOURCE_NOT_AVAILABLE);
      }
    });

    it("should throw resourceNotAvailable for fractional light ID (E1 v1.4.3)", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("1.5");
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
        expect((error as HueApiError).type).toBe(HueErrorType.RESOURCE_NOT_AVAILABLE);
      }
    });

    describe("light type mapping", () => {
      it("should map onoff to LWB007 / Dimmable light", async () => {
        const { service } = createService([{ name: "Switch", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.modelid).toBe("LWB007");
        expect(light.type).toBe("Dimmable light");
      });

      it("should map dimmable to LWB010 / Dimmable light", async () => {
        const { service } = createService([{ name: "Dimmer", lightType: "dimmable" }]);
        const light = await service.getLightById("1");
        expect(light.modelid).toBe("LWB010");
        expect(light.type).toBe("Dimmable light");
      });

      it("should map ct to LTW001 / Color temperature light", async () => {
        const { service } = createService([{ name: "CT", lightType: "ct" }]);
        const light = await service.getLightById("1");
        expect(light.modelid).toBe("LTW001");
        expect(light.type).toBe("Color temperature light");
      });

      it("should map color to LCT003 / Extended color light", async () => {
        const { service } = createService([{ name: "Color", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.modelid).toBe("LCT003");
        expect(light.type).toBe("Extended color light");
      });
    });

    describe("light metadata", () => {
      it("should include manufacturer name", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.manufacturername).toBe("Signify Netherlands B.V.");
      });

      it("should generate unique ID based on light index (D5 v1.4.3 — 24-bit hex suffix)", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.uniqueid).toBe("00:17:88:01:00:00:00:01-0b");
      });

      it("should generate hex-encoded unique ID even at large counts (D5 v1.4.3)", async () => {
        const devices = Array.from({ length: 256 }, (_, i) => ({
          name: `L${i + 1}`,
          lightType: "onoff" as const,
        }));
        const { service } = createService(devices);
        const light10 = await service.getLightById("10");
        expect(light10.uniqueid).toBe("00:17:88:01:00:00:00:0a-0b");
        const light256 = await service.getLightById("256");
        expect(light256.uniqueid).toBe("00:17:88:01:00:00:01:00-0b");
      });

      it("should include software version", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.swversion).toBe("1.0.0");
      });

      it("should set product name from light type config", async () => {
        const { service } = createService([{ name: "Test", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.productname).toBe("Extended Color Light");
      });
    });

    describe("default state values", () => {
      it("should default on to false when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should default bri to 254 when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable" }]);
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it("should default ct to 250 when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct" }]);
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(250);
      });

      it("should default hue to 0 when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(0);
      });

      it("should default sat to 254 when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(254);
      });

      it("should default xy to [0.5, 0.5] when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });
    });

    describe("color mode detection (derived from mapped states, not defaults)", () => {
      it("should set colormode to xy when xy is mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": [0.3, 0.4],
        });
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("xy");
      });

      it("should set colormode to ct when ct is mapped but not xy", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 300 });
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("ct");
      });

      // The fix: a color light with hue+sat mapped but xy UNmapped reports
      // colormode "hs" (derived from the mapped states), not "xy" with the
      // defaulted [0.5,0.5]. Earlier the defaulted xy always won, so a client
      // honouring colormode rendered white instead of the actual hue/sat colour.
      it("reports hs for a color light with hue+sat mapped but xy unmapped", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue", satState: "test.sat" }],
          { "test.hue": 10000, "test.sat": 200 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("hs");
      });

      // Single-channel corner: only hue (or only sat) mapped. Earlier this fell
      // through to the defaulted xy=[0.5,0.5] white; now any mapped hue/sat wins.
      it("reports hs for a color light with ONLY hue mapped (no defaulted-xy white)", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": 10000,
        });
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("hs");
      });

      it("reports hs for a color light with ONLY sat mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": 200,
        });
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("hs");
      });

      it("prioritises mapped ct over hs for a color light (ct mapped, no xy)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue", satState: "test.sat", ctState: "test.ct" }],
          { "test.hue": 10000, "test.sat": 200, "test.ct": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("ct");
      });

      it("prioritises mapped xy over everything for a color light", async () => {
        const { service } = createService(
          [
            {
              name: "Test",
              lightType: "color",
              xyState: "test.xy",
              hueState: "test.hue",
              satState: "test.sat",
              ctState: "test.ct",
            },
          ],
          { "test.xy": [0.4, 0.3], "test.hue": 10000, "test.sat": 200, "test.ct": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("xy");
      });

      it("falls back to xy for a color light with no colour state mapped", async () => {
        // Nothing colour-relevant mapped — the defaulted xy keeps a sane mode.
        const { service } = createService([{ name: "Test", lightType: "color" }]);
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("xy");
      });

      it("a ct light with stray hue/sat config still reports ct (hue/sat not in its state list)", async () => {
        // ct lights expose only [on, bri, ct]; hue/sat config is never read,
        // so the defaulted ct drives colormode.
        const { service } = createService(
          [{ name: "Test", lightType: "ct", hueState: "test.hue", satState: "test.sat" }],
          { "test.hue": 10000, "test.sat": 200 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).toBe("ct");
      });
    });

    describe("state includes reachable and mode", () => {
      it("should set reachable to true", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.state.reachable).toBe(true);
      });

      it("should set mode to homeautomation", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff" }]);
        const light = await service.getLightById("1");
        expect(light.state.mode).toBe("homeautomation");
      });
    });
  });

  // =====================================================================
  // Value conversion: ioBroker → Hue (convertValueFromState)
  // =====================================================================

  describe("value conversion: ioBroker → Hue (reading states)", () => {
    describe("on state", () => {
      it("should convert true to true", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": true,
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(true);
      });

      it("should convert false to false", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": false,
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should convert 1 to true", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": 1 });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(true);
      });

      it("should convert 0 to false", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], { "test.on": 0 });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should handle string 'false' as false (Boolean('false') bug fix)", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": "false",
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should handle string '0' as false", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": "0",
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should handle empty string as false", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": "",
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });

      it("should handle string 'true' as true", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": "true",
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(true);
      });

      it("should handle null as default (false)", async () => {
        const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
          "test.on": null,
        });
        const light = await service.getLightById("1");
        expect(light.state.on).toBe(false);
      });
    });

    describe("bri state (brightness)", () => {
      it("should convert percentage 50 to Hue range (~127)", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 50,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(127);
      });

      it("should convert percentage 100 to 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 100,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it("should clamp percentage 0 up to the Hue minimum of 1 (B1)", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 0,
        });
        const light = await service.getLightById("1");
        // auto le1 branch now clamps to [1,254]: 0 → 1 (Hue bri minimum)
        expect(light.state.bri).toBe(1);
      });

      it("should convert 0-1 range (0.5) to ~127", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 0.5,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(127);
      });

      it("should convert 1.0 to 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 1.0,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      // D3 v1.4.4 — explicit scale per device.
      it("briScale=percent: 1 means 1 % (was 254 under auto-heuristic)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "percent" }],
          { "test.bri": 1 },
        );
        const light = await service.getLightById("1");
        // 1 % of 254 = 2.54 → clampRound to min=1
        expect(light.state.bri).toBeLessThanOrEqual(3);
        expect(light.state.bri).toBeGreaterThanOrEqual(1);
      });

      it("briScale=percent: 50 → ~127 (Hue mid-range)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "percent" }],
          { "test.bri": 50 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(127);
      });

      it("briScale=normalized: 0.5 → 127", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "normalized" }],
          { "test.bri": 0.5 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(127);
      });

      it("briScale=raw: 200 → 200 (Hue native, no rescale)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "raw" }],
          { "test.bri": 200 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(200);
      });

      it("should clamp values above 254 to 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": 300,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it("should return 254 for non-numeric values", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": "not a number",
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });
    });

    describe("hue state", () => {
      it("should pass through values in 0-65535 range", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": 30000,
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(30000);
      });

      it("should clamp to 0 for negative values", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": -100,
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(0);
      });

      it("should clamp to 65535 for values above range", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": 70000,
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(65535);
      });

      it("should round fractional values", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": 30000.7,
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(30001);
      });

      it("should return 0 for non-numeric values", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": "invalid",
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(0);
      });
    });

    describe("sat state (saturation)", () => {
      it("should convert percentage 100 to 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": 100,
        });
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(254);
      });

      it("should convert percentage 50 to ~127", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": 50,
        });
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(127);
      });

      it("should convert 0-1 range (0.5) to ~127", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": 0.5,
        });
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(127);
      });

      it("clamps nonsensical negative values to the Hue minimum (B1)", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": -10,
        });
        const light = await service.getLightById("1");
        // auto le1 branch now clamps to [0,254]: -10 → 0 (was -2540 unclamped)
        expect(light.state.sat).toBe(0);
      });

      it("should clamp to 254 maximum", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": 300,
        });
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(254);
      });
    });

    describe("ct state (color temperature)", () => {
      it("should pass through values in 153-500 range", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 300 });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(300);
      });

      it("should clamp to 153 minimum", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 100 });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(153);
      });

      it("should clamp to 500 maximum", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], { "test.ct": 600 });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(500);
      });

      it("should round fractional values", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], {
          "test.ct": 299.7,
        });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(300);
      });

      it("should return 250 for non-numeric values", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], {
          "test.ct": "warm",
        });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(250);
      });
    });

    describe("xy state", () => {
      it("should pass through array values", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": [0.3127, 0.329],
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.3127, 0.329]);
      });

      it("should parse comma-separated string", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": "0.3127,0.3290",
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.3127, 0.329]);
      });

      it("should truncate arrays longer than 2", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": [0.1, 0.2, 0.3],
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.1, 0.2]);
      });

      it("should return default [0.5, 0.5] for invalid string", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": "invalid",
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });

      it("should return default [0.5, 0.5] for null", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": null,
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });
    });

    // API-drift guards: malformed foreign-state values must not produce NaN/
    // Infinity or leak non-primitive values into the Hue response.
    describe("malformed foreign-state values (reading)", () => {
      it("bri NaN falls back to default 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": Number.NaN,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it("bri Infinity falls back to default 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": Number.POSITIVE_INFINITY,
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it("bri object falls back to default 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": { nested: 42 },
        });
        const light = await service.getLightById("1");
        expect(light.state.bri).toBe(254);
      });

      it('bri numeric string "50" converts as percentage', async () => {
        const { service } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }], {
          "test.bri": "50",
        });
        const light = await service.getLightById("1");
        // 50/100 * 254 = 127
        expect(light.state.bri).toBe(127);
      });

      it("hue NaN falls back to 0", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": Number.NaN,
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(0);
      });

      it('hue numeric string "12345" is coerced', async () => {
        const { service } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }], {
          "test.hue": "12345",
        });
        const light = await service.getLightById("1");
        expect(light.state.hue).toBe(12345);
      });

      it("sat NaN falls back to default 254", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }], {
          "test.sat": Number.NaN,
        });
        const light = await service.getLightById("1");
        expect(light.state.sat).toBe(254);
      });

      it("ct NaN falls back to default 250", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], {
          "test.ct": Number.NaN,
        });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(250);
      });

      it("ct -Infinity falls back to default 250", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], {
          "test.ct": Number.NEGATIVE_INFINITY,
        });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(250);
      });

      it('ct numeric string "200" is coerced', async () => {
        const { service } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }], {
          "test.ct": "200",
        });
        const light = await service.getLightById("1");
        expect(light.state.ct).toBe(200);
      });

      it("xy array with NaN entry falls back to default", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": [Number.NaN, 0.4],
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });

      it("xy array with non-numeric entries falls back to default", async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": ["foo", "bar"],
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });

      it('xy string "nan,0.4" falls back to default', async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": "nan,0.4",
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.5, 0.5]);
      });

      it('xy string of numeric values "0.33,0.29" parses', async () => {
        const { service } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
          "test.xy": "0.33,0.29",
        });
        const light = await service.getLightById("1");
        expect(light.state.xy).toEqual([0.33, 0.29]);
      });
    });
  });

  // =====================================================================
  // Value conversion: Hue → ioBroker (convertValueForState via setLightState)
  // =====================================================================

  describe("value conversion: Hue → ioBroker (setting states)", () => {
    it("should convert on=true to boolean true", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }]);
      await service.setLightState("1", { on: true });
      expect(adapter.writtenStates.get("test.on")).toBe(true);
    });

    it("should convert on=false to boolean false", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }]);
      await service.setLightState("1", { on: false });
      expect(adapter.writtenStates.get("test.on")).toBe(false);
    });

    it("should clamp bri to 1-254 range", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
      await service.setLightState("1", { bri: 300 });
      expect(adapter.writtenStates.get("test.bri")).toBe(254);
    });

    // D3 v1.4.4 — write back in source scale so other consumers stay coherent.
    it("briScale=percent: writes back as 0..100 percent (D3 v1.4.4)", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "percent" },
      ]);
      await service.setLightState("1", { bri: 254 });
      expect(adapter.writtenStates.get("test.bri")).toBe(100);
    });

    it("briScale=normalized: writes back as 0..1 (D3 v1.4.4)", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "normalized" },
      ]);
      await service.setLightState("1", { bri: 127 });
      const v = adapter.writtenStates.get("test.bri") as number;
      expect(v).toBeCloseTo(0.5, 2);
    });

    it("briScale=raw: writes back unchanged Hue value (D3 v1.4.4)", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "dimmable", briState: "test.bri", briScale: "raw" },
      ]);
      await service.setLightState("1", { bri: 200 });
      expect(adapter.writtenStates.get("test.bri")).toBe(200);
    });

    it("satScale=percent: writes back as 0..100 (D3 v1.4.4)", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "color", satState: "test.sat", satScale: "percent" },
      ]);
      await service.setLightState("1", { sat: 254 });
      expect(adapter.writtenStates.get("test.sat")).toBe(100);
    });

    it("should clamp bri minimum to 1", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
      await service.setLightState("1", { bri: 0 });
      expect(adapter.writtenStates.get("test.bri")).toBe(1);
    });

    it("should clamp hue to 0-65535", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }]);
      await service.setLightState("1", { hue: 70000 });
      expect(adapter.writtenStates.get("test.hue")).toBe(65535);
    });

    it("should clamp sat to 0-254", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }]);
      await service.setLightState("1", { sat: 300 });
      expect(adapter.writtenStates.get("test.sat")).toBe(254);
    });

    it("should clamp ct to 153-500", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }]);
      await service.setLightState("1", { ct: 100 });
      expect(adapter.writtenStates.get("test.ct")).toBe(153);
    });

    it("should serialize xy array as JSON string", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }]);
      await service.setLightState("1", { xy: [0.3, 0.4] });
      expect(adapter.writtenStates.get("test.xy")).toBe("[0.3,0.4]");
    });

    it("skips the xy write for a non-array value instead of storing junk like '[object Object]'", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }]);
      await service.setLightState("1", { xy: { x: 1 } } as unknown as Record<string, unknown>);
      // No junk written — the foreign state is left untouched
      expect(adapter.writtenStates.has("test.xy")).toBe(false);
    });

    it("skips the xy write for an array with non-numeric entries", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }]);
      await service.setLightState("1", { xy: ["a", "b"] } as unknown as Record<string, unknown>);
      expect(adapter.writtenStates.has("test.xy")).toBe(false);
    });

    // D4 v1.4.3 — write side serialises xy as JSON string `"[0.3,0.4]"`.
    // Earlier the read side only handled CSV strings — a stored `"[0.3,0.4]"`
    // got split by comma to `["[0.3","0.4]"]`, parseFloat returned NaN, and
    // the value collapsed to the [0.5, 0.5] default. Round-trip now intact.
    it("xy round-trips through JSON-stringified storage (D4 v1.4.3)", async () => {
      const { service, adapter } = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], {
        "test.xy": "[0.3,0.4]",
      });
      const light = await service.getLightById("1");
      expect(light.state.xy).toEqual([0.3, 0.4]);

      // And after a write, the same JSON string round-trips back
      await service.setLightState("1", { xy: [0.7, 0.2] });
      const stored = adapter.writtenStates.get("test.xy");
      expect(stored).toBe("[0.7,0.2]");
      // Simulate the next foreign-state read returning the stored JSON string.
      const fresh = createService([{ name: "Test", lightType: "color", xyState: "test.xy" }], { "test.xy": stored });
      const refreshed = await fresh.service.getLightById("1");
      expect(refreshed.state.xy).toEqual([0.7, 0.2]);
    });

    // API-drift guards: malformed incoming Hue-client values must not leak
    // NaN / Infinity / non-primitive payloads into ioBroker states.
    describe("malformed incoming Hue values (writing)", () => {
      it("bri NaN falls back to default 254", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
        await service.setLightState("1", {
          bri: Number.NaN,
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.bri")).toBe(254);
      });

      it("bri Infinity clamps to 254", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
        await service.setLightState("1", {
          bri: Number.POSITIVE_INFINITY,
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.bri")).toBe(254);
      });

      it("bri fractional value is rounded", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
        await service.setLightState("1", { bri: 200.7 });
        expect(adapter.writtenStates.get("test.bri")).toBe(201);
      });

      it('bri numeric string "150" is coerced', async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "dimmable", briState: "test.bri" }]);
        await service.setLightState("1", {
          bri: "150",
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.bri")).toBe(150);
      });

      it("hue NaN falls back to 0", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }]);
        await service.setLightState("1", {
          hue: Number.NaN,
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.hue")).toBe(0);
      });

      it("hue object falls back to 0", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "color", hueState: "test.hue" }]);
        await service.setLightState("1", {
          hue: { foo: 1 },
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.hue")).toBe(0);
      });

      it("sat Infinity clamps to 254", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "color", satState: "test.sat" }]);
        await service.setLightState("1", {
          sat: Number.POSITIVE_INFINITY,
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.sat")).toBe(254);
      });

      it("ct NaN falls back to default 250", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }]);
        await service.setLightState("1", {
          ct: Number.NaN,
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.ct")).toBe(250);
      });

      it('ct numeric string "200" is coerced', async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }]);
        await service.setLightState("1", {
          ct: "200",
        } as unknown as Record<string, unknown>);
        expect(adapter.writtenStates.get("test.ct")).toBe(200);
      });

      it("ct fractional is rounded", async () => {
        const { service, adapter } = createService([{ name: "Test", lightType: "ct", ctState: "test.ct" }]);
        await service.setLightState("1", { ct: 200.4 });
        expect(adapter.writtenStates.get("test.ct")).toBe(200);
      });
    });
  });

  describe("setLightState", () => {
    it("should return success results for each key", async () => {
      const { service } = createService([
        {
          name: "Test",
          lightType: "dimmable",
          onState: "test.on",
          briState: "test.bri",
        },
      ]);
      const results = await service.setLightState("1", { on: true, bri: 200 });
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty("success");
      expect(results[1]).toHaveProperty("success");
    });

    it("should include correct address paths in success", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }]);
      const results = await service.setLightState("1", { on: true });
      const firstResult = results[0] as { success: Record<string, unknown> };
      expect(firstResult.success).toHaveProperty("/lights/1/state/on");
    });

    it("should still report success for unmapped states", async () => {
      const { service } = createService(
        [{ name: "Test", lightType: "onoff" }], // no onState mapped
      );
      const results = await service.setLightState("1", { on: true });
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty("success");
    });

    it("should throw for invalid light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.setLightState("99", { on: true });
        throw new Error("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HueApiError);
      }
    });
  });

  describe("state cache", () => {
    it("should use cached values when available", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }], {
        "test.on": false,
      });
      // Pre-populate cache by reading once
      await service.getLightById("1");

      // Update cache directly
      service.updateStateCache("test.on", true);

      // Should read from cache
      const light = await service.getLightById("1");
      expect(light.state.on).toBe(true);
    });

    it("should update cache when setting state", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff", onState: "test.on" }]);
      await service.setLightState("1", { on: true });

      // Cache should be updated with the converted value
      const light = await service.getLightById("1");
      expect(light.state.on).toBe(true);
    });
  });

  describe("initialize", () => {
    it("should subscribe to all mapped state IDs", async () => {
      const { service, adapter } = createService([
        {
          name: "Test",
          lightType: "color",
          onState: "lights.kitchen.on",
          briState: "lights.kitchen.bri",
          hueState: "lights.kitchen.hue",
          satState: "lights.kitchen.sat",
          ctState: "lights.kitchen.ct",
          xyState: "lights.kitchen.xy",
        },
      ]);
      await service.initialize();

      expect(adapter.subscribedPatterns).toContain("lights.kitchen.on");
      expect(adapter.subscribedPatterns).toContain("lights.kitchen.bri");
      expect(adapter.subscribedPatterns).toContain("lights.kitchen.hue");
      expect(adapter.subscribedPatterns).toContain("lights.kitchen.sat");
      expect(adapter.subscribedPatterns).toContain("lights.kitchen.ct");
      expect(adapter.subscribedPatterns).toContain("lights.kitchen.xy");
    });

    it("should not subscribe if no states are mapped", async () => {
      const { service, adapter } = createService(
        [{ name: "Test", lightType: "onoff" }], // no state IDs mapped
      );
      await service.initialize();
      expect(adapter.subscribedPatterns).toHaveLength(0);
    });

    it("warns when a configured state object does not exist (init misconfiguration diagnostic)", async () => {
      const adapter = createMockDeviceBindingAdapter({}); // no states exist
      const logger = spyLogger();
      const service = new DeviceBindingService({
        adapter,
        devices: [{ name: "Typo", lightType: "dimmable", onState: "does.not.exist" }],
        logger,
      });
      await service.initialize();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("does.not.exist"));
    });

    it("warns when a color light has no colour state mapped", async () => {
      const adapter = createMockDeviceBindingAdapter({ "x.on": true });
      const logger = spyLogger();
      const service = new DeviceBindingService({
        adapter,
        devices: [{ name: "ColorNoStates", lightType: "color", onState: "x.on" }],
        logger,
      });
      await service.initialize();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("no colour state"));
    });
  });
});

// =====================================================================
// Integration-style tests: light types with full state reading
// =====================================================================

describe("Light type integration", () => {
  function createServiceWithStates(device: DeviceConfig, stateValues: Record<string, unknown>) {
    const adapter = createMockDeviceBindingAdapter(stateValues);
    const logger = createMockLogger();
    const service = new DeviceBindingService({
      adapter,
      devices: [device],
      logger,
    });
    return { service, adapter };
  }

  it("should build complete onoff light from states", async () => {
    const { service } = createServiceWithStates(
      {
        name: "Kitchen Switch",
        lightType: "onoff",
        onState: "hm-rpc.0.switch.STATE",
      },
      { "hm-rpc.0.switch.STATE": true },
    );

    const light = await service.getLightById("1");
    expect(light.name).toBe("Kitchen Switch");
    expect(light.type).toBe("Dimmable light");
    expect(light.modelid).toBe("LWB007");
    expect(light.state.on).toBe(true);
    expect(light.state.reachable).toBe(true);
    // onoff type includes bri in its states array (from LIGHT_TYPES)
    expect(light.state.bri).toBe(254); // default since not mapped
  });

  it("should build complete dimmable light from states", async () => {
    const { service } = createServiceWithStates(
      {
        name: "Living Room",
        lightType: "dimmable",
        onState: "deconz.0.light.on",
        briState: "deconz.0.light.bri",
      },
      { "deconz.0.light.on": true, "deconz.0.light.bri": 75 },
    );

    const light = await service.getLightById("1");
    expect(light.name).toBe("Living Room");
    expect(light.type).toBe("Dimmable light");
    expect(light.modelid).toBe("LWB010");
    expect(light.state.on).toBe(true);
    // 75 is in 0-100 range, so (75/100)*254 = 190.5 → 191
    expect(light.state.bri).toBe(191);
  });

  it("should build complete ct light from states", async () => {
    const { service } = createServiceWithStates(
      {
        name: "Bedroom",
        lightType: "ct",
        onState: "zigbee.0.light.on",
        briState: "zigbee.0.light.bri",
        ctState: "zigbee.0.light.ct",
      },
      {
        "zigbee.0.light.on": false,
        "zigbee.0.light.bri": 100,
        "zigbee.0.light.ct": 350,
      },
    );

    const light = await service.getLightById("1");
    expect(light.name).toBe("Bedroom");
    expect(light.type).toBe("Color temperature light");
    expect(light.modelid).toBe("LTW001");
    expect(light.state.on).toBe(false);
    expect(light.state.bri).toBe(254); // 100 maps to 254
    expect(light.state.ct).toBe(350);
    expect(light.state.colormode).toBe("ct");
  });

  it("should build complete color light from states", async () => {
    const { service } = createServiceWithStates(
      {
        name: "Party Light",
        lightType: "color",
        onState: "hue.0.light.on",
        briState: "hue.0.light.bri",
        hueState: "hue.0.light.hue",
        satState: "hue.0.light.sat",
        ctState: "hue.0.light.ct",
        xyState: "hue.0.light.xy",
      },
      {
        "hue.0.light.on": true,
        "hue.0.light.bri": 80,
        "hue.0.light.hue": 25000,
        "hue.0.light.sat": 200,
        "hue.0.light.ct": 200,
        "hue.0.light.xy": [0.4, 0.3],
      },
    );

    const light = await service.getLightById("1");
    expect(light.name).toBe("Party Light");
    expect(light.type).toBe("Extended color light");
    expect(light.modelid).toBe("LCT003");
    expect(light.state.on).toBe(true);
    // 80 in percentage range: round(80/100 * 254) = 203
    expect(light.state.bri).toBe(203);
    expect(light.state.hue).toBe(25000);
    expect(light.state.sat).toBe(200);
    expect(light.state.ct).toBe(200);
    expect(light.state.xy).toEqual([0.4, 0.3]);
    // xy takes precedence for colormode
    expect(light.state.colormode).toBe("xy");
  });

  it("should handle missing ioBroker state gracefully", async () => {
    const { service } = createServiceWithStates(
      {
        name: "Offline Light",
        lightType: "dimmable",
        onState: "nonexistent.0.state",
        briState: "nonexistent.0.bri",
      },
      {}, // no states exist
    );

    // Should not throw, should use defaults
    const light = await service.getLightById("1");
    expect(light.state.on).toBe(false); // default
    expect(light.state.bri).toBe(254); // default
  });
});
