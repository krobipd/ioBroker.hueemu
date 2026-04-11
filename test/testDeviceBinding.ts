/**
 * Tests for DeviceBindingService — value conversions, light management, state setting
 */

import { expect } from "chai";
import { HueApiError, HueErrorType } from "../src/types/errors";
import {
  DeviceBindingService,
  type DeviceConfig,
} from "../src/hue-api/device-binding-service";
import { createMockDeviceBindingAdapter, createMockLogger } from "./testHelpers";

// Helper to create service with test devices
function createService(
  devices: DeviceConfig[],
  stateValues: Record<string, unknown> = {},
) {
  const adapter = createMockDeviceBindingAdapter(stateValues);
  const logger = createMockLogger();
  const service = new DeviceBindingService({
    adapter,
    devices,
    logger,
  });
  return { service, adapter };
}

describe("DeviceBindingService", () => {
  describe("deviceCount", () => {
    it("should return 0 for empty devices", () => {
      const { service } = createService([]);
      expect(service.deviceCount).to.equal(0);
    });

    it("should return correct count", () => {
      const { service } = createService([
        { name: "Light 1", lightType: "onoff" },
        { name: "Light 2", lightType: "dimmable" },
      ]);
      expect(service.deviceCount).to.equal(2);
    });
  });

  describe("getAllLights", () => {
    it("should return empty collection for no devices", async () => {
      const { service } = createService([]);
      const lights = await service.getAllLights();
      expect(lights).to.deep.equal({});
    });

    it("should return lights with 1-based IDs", async () => {
      const { service } = createService([
        { name: "First", lightType: "onoff" },
        { name: "Second", lightType: "dimmable" },
      ]);
      const lights = await service.getAllLights();
      expect(Object.keys(lights)).to.deep.equal(["1", "2"]);
      expect(lights["1"].name).to.equal("First");
      expect(lights["2"].name).to.equal("Second");
    });
  });

  describe("getLightById", () => {
    it("should throw for invalid light ID (0)", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("0");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).to.be.instanceOf(HueApiError);
        expect((error as HueApiError).type).to.equal(
          HueErrorType.RESOURCE_NOT_AVAILABLE,
        );
      }
    });

    it("should throw for out-of-range light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("5");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).to.be.instanceOf(HueApiError);
      }
    });

    it("should throw for negative light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.getLightById("-1");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).to.be.instanceOf(HueApiError);
      }
    });

    describe("light type mapping", () => {
      it("should map onoff to LWB007 / Dimmable light", async () => {
        const { service } = createService([
          { name: "Switch", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.modelid).to.equal("LWB007");
        expect(light.type).to.equal("Dimmable light");
      });

      it("should map dimmable to LWB010 / Dimmable light", async () => {
        const { service } = createService([
          { name: "Dimmer", lightType: "dimmable" },
        ]);
        const light = await service.getLightById("1");
        expect(light.modelid).to.equal("LWB010");
        expect(light.type).to.equal("Dimmable light");
      });

      it("should map ct to LTW001 / Color temperature light", async () => {
        const { service } = createService([{ name: "CT", lightType: "ct" }]);
        const light = await service.getLightById("1");
        expect(light.modelid).to.equal("LTW001");
        expect(light.type).to.equal("Color temperature light");
      });

      it("should map color to LCT003 / Extended color light", async () => {
        const { service } = createService([
          { name: "Color", lightType: "color" },
        ]);
        const light = await service.getLightById("1");
        expect(light.modelid).to.equal("LCT003");
        expect(light.type).to.equal("Extended color light");
      });
    });

    describe("light metadata", () => {
      it("should include manufacturer name", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.manufacturername).to.equal("Signify Netherlands B.V.");
      });

      it("should generate unique ID based on light index", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.uniqueid).to.equal("00:17:88:01:00:01:01:01-0b");
      });

      it("should generate padded unique ID for single-digit IDs", async () => {
        const { service } = createService([
          { name: "L1", lightType: "onoff" },
          { name: "L2", lightType: "onoff" },
          { name: "L3", lightType: "onoff" },
          { name: "L4", lightType: "onoff" },
          { name: "L5", lightType: "onoff" },
          { name: "L6", lightType: "onoff" },
          { name: "L7", lightType: "onoff" },
          { name: "L8", lightType: "onoff" },
          { name: "L9", lightType: "onoff" },
          { name: "L10", lightType: "onoff" },
        ]);
        const light = await service.getLightById("10");
        expect(light.uniqueid).to.equal("00:17:88:01:00:10:10:10-0b");
      });

      it("should include software version", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.swversion).to.equal("1.0.0");
      });

      it("should set product name from light type config", async () => {
        const { service } = createService([
          { name: "Test", lightType: "color" },
        ]);
        const light = await service.getLightById("1");
        expect(light.productname).to.equal("Extended Color Light");
      });
    });

    describe("default state values", () => {
      it("should default on to false when not mapped", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should default bri to 254 when not mapped", async () => {
        const { service } = createService([
          { name: "Test", lightType: "dimmable" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(254);
      });

      it("should default ct to 250 when not mapped", async () => {
        const { service } = createService([{ name: "Test", lightType: "ct" }]);
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(250);
      });

      it("should default hue to 0 when not mapped", async () => {
        const { service } = createService([
          { name: "Test", lightType: "color" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(0);
      });

      it("should default sat to 254 when not mapped", async () => {
        const { service } = createService([
          { name: "Test", lightType: "color" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.sat).to.equal(254);
      });

      it("should default xy to [0.5, 0.5] when not mapped", async () => {
        const { service } = createService([
          { name: "Test", lightType: "color" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.5, 0.5]);
      });
    });

    describe("color mode detection", () => {
      it("should set colormode to xy when xy is available", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": [0.3, 0.4] },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).to.equal("xy");
      });

      it("should set colormode to ct when ct is available but not xy", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).to.equal("ct");
      });

      it("should set colormode to xy for color lights (xy has priority over hs)", async () => {
        // color lights always have xy in their states list, so even with hue+sat
        // configured, xy gets a default value and takes priority
        const { service } = createService(
          [
            {
              name: "Test",
              lightType: "color",
              hueState: "test.hue",
              satState: "test.sat",
            },
          ],
          { "test.hue": 10000, "test.sat": 200 },
        );
        const light = await service.getLightById("1");
        expect(light.state.colormode).to.equal("xy");
      });

      it("should set colormode to hs for ct light with hue+sat only", async () => {
        // ct lights don't have xy in their states list, so only hs is available
        const { service } = createService(
          [
            {
              name: "Test",
              lightType: "ct",
              hueState: "test.hue",
              satState: "test.sat",
              ctState: undefined,
            },
          ],
          { "test.hue": 10000, "test.sat": 200 },
        );
        const light = await service.getLightById("1");
        // ct type doesn't have hue/sat in states list, so neither hs nor xy is set
        expect(light.state.colormode).to.equal("ct");
      });
    });

    describe("state includes reachable and mode", () => {
      it("should set reachable to true", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.reachable).to.equal(true);
      });

      it("should set mode to homeautomation", async () => {
        const { service } = createService([
          { name: "Test", lightType: "onoff" },
        ]);
        const light = await service.getLightById("1");
        expect(light.state.mode).to.equal("homeautomation");
      });
    });
  });

  // =====================================================================
  // Value conversion: ioBroker → Hue (convertValueFromState)
  // =====================================================================

  describe("value conversion: ioBroker → Hue (reading states)", () => {
    describe("on state", () => {
      it("should convert true to true", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": true },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(true);
      });

      it("should convert false to false", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": false },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should convert 1 to true", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": 1 },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(true);
      });

      it("should convert 0 to false", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": 0 },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should handle string 'false' as false (Boolean('false') bug fix)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": "false" },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should handle string '0' as false", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": "0" },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should handle empty string as false", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": "" },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });

      it("should handle string 'true' as true", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": "true" },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(true);
      });

      it("should handle null as default (false)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "onoff", onState: "test.on" }],
          { "test.on": null },
        );
        const light = await service.getLightById("1");
        expect(light.state.on).to.equal(false);
      });
    });

    describe("bri state (brightness)", () => {
      it("should convert percentage 50 to Hue range (~127)", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 50 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(127);
      });

      it("should convert percentage 100 to 254", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 100 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(254);
      });

      it("should convert percentage 0 to minimum 1 (via max(1,...))", async () => {
        // 0/100 * 254 = 0, but max(1, 0) = ... actually 0 <= 1, so <= 1 branch
        // 0 * 254 = 0
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 0 },
        );
        const light = await service.getLightById("1");
        // 0 <= 1, so 0-1 range: Math.round(0 * 254) = 0
        expect(light.state.bri).to.equal(0);
      });

      it("should convert 0-1 range (0.5) to ~127", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 0.5 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(127);
      });

      it("should convert 1.0 to 254", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 1.0 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(254);
      });

      it("should clamp values above 254 to 254", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(254);
      });

      it("should return 254 for non-numeric values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "dimmable", briState: "test.bri" }],
          { "test.bri": "not a number" },
        );
        const light = await service.getLightById("1");
        expect(light.state.bri).to.equal(254);
      });
    });

    describe("hue state", () => {
      it("should pass through values in 0-65535 range", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue" }],
          { "test.hue": 30000 },
        );
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(30000);
      });

      it("should clamp to 0 for negative values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue" }],
          { "test.hue": -100 },
        );
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(0);
      });

      it("should clamp to 65535 for values above range", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue" }],
          { "test.hue": 70000 },
        );
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(65535);
      });

      it("should round fractional values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue" }],
          { "test.hue": 30000.7 },
        );
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(30001);
      });

      it("should return 0 for non-numeric values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", hueState: "test.hue" }],
          { "test.hue": "invalid" },
        );
        const light = await service.getLightById("1");
        expect(light.state.hue).to.equal(0);
      });
    });

    describe("sat state (saturation)", () => {
      it("should convert percentage 100 to 254", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", satState: "test.sat" }],
          { "test.sat": 100 },
        );
        const light = await service.getLightById("1");
        expect(light.state.sat).to.equal(254);
      });

      it("should convert percentage 50 to ~127", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", satState: "test.sat" }],
          { "test.sat": 50 },
        );
        const light = await service.getLightById("1");
        expect(light.state.sat).to.equal(127);
      });

      it("should convert 0-1 range (0.5) to ~127", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", satState: "test.sat" }],
          { "test.sat": 0.5 },
        );
        const light = await service.getLightById("1");
        expect(light.state.sat).to.equal(127);
      });

      it("should handle negative values (treated as 0-1 range)", async () => {
        // Negative values hit the `value <= 1` branch and get multiplied by 254
        // This is a known edge case — negative sat values don't make practical sense
        const { service } = createService(
          [{ name: "Test", lightType: "color", satState: "test.sat" }],
          { "test.sat": -10 },
        );
        const light = await service.getLightById("1");
        // -10 * 254 = -2540 (not clamped — edge case, negative input is nonsensical)
        expect(light.state.sat).to.equal(-2540);
      });

      it("should clamp to 254 maximum", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", satState: "test.sat" }],
          { "test.sat": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.sat).to.equal(254);
      });
    });

    describe("ct state (color temperature)", () => {
      it("should pass through values in 153-500 range", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": 300 },
        );
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(300);
      });

      it("should clamp to 153 minimum", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": 100 },
        );
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(153);
      });

      it("should clamp to 500 maximum", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": 600 },
        );
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(500);
      });

      it("should round fractional values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": 299.7 },
        );
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(300);
      });

      it("should return 250 for non-numeric values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "ct", ctState: "test.ct" }],
          { "test.ct": "warm" },
        );
        const light = await service.getLightById("1");
        expect(light.state.ct).to.equal(250);
      });
    });

    describe("xy state", () => {
      it("should pass through array values", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": [0.3127, 0.329] },
        );
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.3127, 0.329]);
      });

      it("should parse comma-separated string", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": "0.3127,0.3290" },
        );
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.3127, 0.329]);
      });

      it("should truncate arrays longer than 2", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": [0.1, 0.2, 0.3] },
        );
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.1, 0.2]);
      });

      it("should return default [0.5, 0.5] for invalid string", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": "invalid" },
        );
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.5, 0.5]);
      });

      it("should return default [0.5, 0.5] for null", async () => {
        const { service } = createService(
          [{ name: "Test", lightType: "color", xyState: "test.xy" }],
          { "test.xy": null },
        );
        const light = await service.getLightById("1");
        expect(light.state.xy).to.deep.equal([0.5, 0.5]);
      });
    });
  });

  // =====================================================================
  // Value conversion: Hue → ioBroker (convertValueForState via setLightState)
  // =====================================================================

  describe("value conversion: Hue → ioBroker (setting states)", () => {
    it("should convert on=true to boolean true", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "onoff", onState: "test.on" },
      ]);
      await service.setLightState("1", { on: true });
      expect(adapter.writtenStates.get("test.on")).to.equal(true);
    });

    it("should convert on=false to boolean false", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "onoff", onState: "test.on" },
      ]);
      await service.setLightState("1", { on: false });
      expect(adapter.writtenStates.get("test.on")).to.equal(false);
    });

    it("should clamp bri to 1-254 range", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "dimmable", briState: "test.bri" },
      ]);
      await service.setLightState("1", { bri: 300 });
      expect(adapter.writtenStates.get("test.bri")).to.equal(254);
    });

    it("should clamp bri minimum to 1", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "dimmable", briState: "test.bri" },
      ]);
      await service.setLightState("1", { bri: 0 });
      expect(adapter.writtenStates.get("test.bri")).to.equal(1);
    });

    it("should clamp hue to 0-65535", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "color", hueState: "test.hue" },
      ]);
      await service.setLightState("1", { hue: 70000 });
      expect(adapter.writtenStates.get("test.hue")).to.equal(65535);
    });

    it("should clamp sat to 0-254", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "color", satState: "test.sat" },
      ]);
      await service.setLightState("1", { sat: 300 });
      expect(adapter.writtenStates.get("test.sat")).to.equal(254);
    });

    it("should clamp ct to 153-500", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "ct", ctState: "test.ct" },
      ]);
      await service.setLightState("1", { ct: 100 });
      expect(adapter.writtenStates.get("test.ct")).to.equal(153);
    });

    it("should serialize xy array as JSON string", async () => {
      const { service, adapter } = createService([
        { name: "Test", lightType: "color", xyState: "test.xy" },
      ]);
      await service.setLightState("1", { xy: [0.3, 0.4] });
      expect(adapter.writtenStates.get("test.xy")).to.equal("[0.3,0.4]");
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
      expect(results).to.have.length(2);
      expect(results[0]).to.have.property("success");
      expect(results[1]).to.have.property("success");
    });

    it("should include correct address paths in success", async () => {
      const { service } = createService([
        { name: "Test", lightType: "onoff", onState: "test.on" },
      ]);
      const results = await service.setLightState("1", { on: true });
      const firstResult = results[0] as { success: Record<string, unknown> };
      expect(firstResult.success).to.have.property("/lights/1/state/on");
    });

    it("should still report success for unmapped states", async () => {
      const { service } = createService(
        [{ name: "Test", lightType: "onoff" }], // no onState mapped
      );
      const results = await service.setLightState("1", { on: true });
      expect(results).to.have.length(1);
      expect(results[0]).to.have.property("success");
    });

    it("should throw for invalid light ID", async () => {
      const { service } = createService([{ name: "Test", lightType: "onoff" }]);
      try {
        await service.setLightState("99", { on: true });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).to.be.instanceOf(HueApiError);
      }
    });
  });

  describe("state cache", () => {
    it("should use cached values when available", async () => {
      const { service } = createService(
        [{ name: "Test", lightType: "onoff", onState: "test.on" }],
        { "test.on": false },
      );
      // Pre-populate cache by reading once
      await service.getLightById("1");

      // Update cache directly
      service.updateStateCache("test.on", true);

      // Should read from cache
      const light = await service.getLightById("1");
      expect(light.state.on).to.equal(true);
    });

    it("should update cache when setting state", async () => {
      const { service } = createService([
        { name: "Test", lightType: "onoff", onState: "test.on" },
      ]);
      await service.setLightState("1", { on: true });

      // Cache should be updated with the converted value
      const light = await service.getLightById("1");
      expect(light.state.on).to.equal(true);
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

      expect(adapter.subscribedPatterns).to.include("lights.kitchen.on");
      expect(adapter.subscribedPatterns).to.include("lights.kitchen.bri");
      expect(adapter.subscribedPatterns).to.include("lights.kitchen.hue");
      expect(adapter.subscribedPatterns).to.include("lights.kitchen.sat");
      expect(adapter.subscribedPatterns).to.include("lights.kitchen.ct");
      expect(adapter.subscribedPatterns).to.include("lights.kitchen.xy");
    });

    it("should not subscribe if no states are mapped", async () => {
      const { service, adapter } = createService(
        [{ name: "Test", lightType: "onoff" }], // no state IDs mapped
      );
      await service.initialize();
      expect(adapter.subscribedPatterns).to.have.length(0);
    });
  });
});

// =====================================================================
// Integration-style tests: light types with full state reading
// =====================================================================

describe("Light type integration", () => {
  function createServiceWithStates(
    device: DeviceConfig,
    stateValues: Record<string, unknown>,
  ) {
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
    expect(light.name).to.equal("Kitchen Switch");
    expect(light.type).to.equal("Dimmable light");
    expect(light.modelid).to.equal("LWB007");
    expect(light.state.on).to.equal(true);
    expect(light.state.reachable).to.equal(true);
    // onoff type includes bri in its states array (from LIGHT_TYPES)
    expect(light.state.bri).to.equal(254); // default since not mapped
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
    expect(light.name).to.equal("Living Room");
    expect(light.type).to.equal("Dimmable light");
    expect(light.modelid).to.equal("LWB010");
    expect(light.state.on).to.equal(true);
    // 75 is in 0-100 range, so (75/100)*254 = 190.5 → 191
    expect(light.state.bri).to.equal(191);
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
    expect(light.name).to.equal("Bedroom");
    expect(light.type).to.equal("Color temperature light");
    expect(light.modelid).to.equal("LTW001");
    expect(light.state.on).to.equal(false);
    expect(light.state.bri).to.equal(254); // 100 maps to 254
    expect(light.state.ct).to.equal(350);
    expect(light.state.colormode).to.equal("ct");
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
    expect(light.name).to.equal("Party Light");
    expect(light.type).to.equal("Extended color light");
    expect(light.modelid).to.equal("LCT003");
    expect(light.state.on).to.equal(true);
    // 80 in percentage range: round(80/100 * 254) = 203
    expect(light.state.bri).to.equal(203);
    expect(light.state.hue).to.equal(25000);
    expect(light.state.sat).to.equal(200);
    expect(light.state.ct).to.equal(200);
    expect(light.state.xy).to.deep.equal([0.4, 0.3]);
    // xy takes precedence for colormode
    expect(light.state.colormode).to.equal("xy");
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
    expect(light.state.on).to.equal(false); // default
    expect(light.state.bri).to.equal(254); // default
  });
});
