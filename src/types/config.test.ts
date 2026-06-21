/**
 * Tests for config utilities and ConfigService
 */

import { detectPrimaryIPv4, generateBridgeId, generateSerialNumber, macFromUdn, validateNetworkConfig } from "./config";
import { ConfigService } from "../hue-api/config-service";
import { createTestIdentity } from "../../test/test-helpers";

describe("Config utilities", () => {
  describe("macFromUdn", () => {
    it("derives a colon-paired MAC from a UUID (dashes stripped, first 12 hex)", () => {
      expect(macFromUdn("12345678-1234-1234-1234-123456789abc")).toBe("12:34:56:78:12:34");
    });

    it("zero-pads a short UDN to 12 hex chars", () => {
      expect(macFromUdn("ab-cd")).toBe("ab:cd:00:00:00:00");
    });

    it("is deterministic — same UDN yields the same MAC", () => {
      const udn = "12345678-1234-1234-1234-123456789abc";
      expect(macFromUdn(udn)).toBe(macFromUdn(udn));
    });
  });

  describe("generateBridgeId", () => {
    it("should insert FFFE in the middle of the MAC", () => {
      const result = generateBridgeId("AA:BB:CC:DD:EE:FF");
      expect(result).toBe("AABBCCFFFEDDEEFF");
    });

    it("should strip colons and uppercase", () => {
      const result = generateBridgeId("aa:bb:cc:dd:ee:ff");
      expect(result).toBe("AABBCCFFFEDDEEFF");
    });

    it("should handle MAC without colons", () => {
      const result = generateBridgeId("AABBCCDDEEFF");
      expect(result).toBe("AABBCCFFFEDDEEFF");
    });

    it("strips non-hex characters (hand-typed/garbled mac)", () => {
      expect(generateBridgeId("aa:bb<x>cc dd:ee:ff")).toBe("AABBCCFFFEDDEEFF");
    });
  });

  describe("generateSerialNumber", () => {
    it("should strip colons and lowercase", () => {
      const result = generateSerialNumber("AA:BB:CC:DD:EE:FF");
      expect(result).toBe("aabbccddeeff");
    });

    it("should handle already lowercase MAC", () => {
      const result = generateSerialNumber("aa:bb:cc:dd:ee:ff");
      expect(result).toBe("aabbccddeeff");
    });

    it("should handle MAC without colons", () => {
      const result = generateSerialNumber("AABBCCDDEEFF");
      expect(result).toBe("aabbccddeeff");
    });

    it("strips non-hex characters (garbled mac that feeds description.xml)", () => {
      expect(generateSerialNumber("aa:bb<x>cc dd:ee:ff")).toBe("aabbccddeeff");
    });
  });

  describe("detectPrimaryIPv4", () => {
    it("returns an empty string or a dotted-quad IPv4 (best-effort host IP)", () => {
      const ip = detectPrimaryIPv4();
      expect(ip === "" || /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)).toBe(true);
    });
  });

  describe("validateNetworkConfig", () => {
    it("passes for a valid host with no HTTPS port", () => {
      expect(() => validateNetworkConfig("192.168.1.5", 8080, undefined)).not.toThrow();
    });

    it("passes when the HTTPS port differs from the HTTP port", () => {
      expect(() => validateNetworkConfig("192.168.1.5", 8080, 443)).not.toThrow();
    });

    it("throws when no routable advertise IP could be resolved (empty)", () => {
      expect(() => validateNetworkConfig("", 8080, undefined)).toThrow(/routable IP/i);
    });

    it("throws for a 0.0.0.0 advertise address (not routable for clients)", () => {
      expect(() => validateNetworkConfig("0.0.0.0", 8080, undefined)).toThrow(/routable IP/i);
    });

    it("throws when the HTTPS port equals the HTTP port", () => {
      expect(() => validateNetworkConfig("192.168.1.5", 8080, 8080)).toThrow(/equals HTTP port/i);
    });
  });
});

describe("ConfigService", () => {
  const identity = createTestIdentity();
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService({
      identity,
      advertiseHost: "192.168.1.100",
    });
  });

  describe("getConfig (public)", () => {
    it("should return bridge name", () => {
      const config = service.getConfig();
      expect(config.name).toBe("Philips hue");
    });

    it("should return correct model ID", () => {
      const config = service.getConfig();
      expect(config.modelid).toBe("BSB002");
    });

    it("should include MAC address from identity", () => {
      const config = service.getConfig();
      expect(config.mac).toBe(identity.mac);
    });

    it("should include bridge ID from identity", () => {
      const config = service.getConfig();
      expect(config.bridgeid).toBe(identity.bridgeId);
    });

    it("should report factorynew as false", () => {
      const config = service.getConfig();
      expect(config.factorynew).toBe(false);
    });

    it("should have null replacesbridgeid", () => {
      const config = service.getConfig();
      expect(config.replacesbridgeid).toBeNull();
    });

    it("should include API version", () => {
      const config = service.getConfig();
      expect(config.apiversion).toBe("1.41.0");
    });

    it("should include SW version", () => {
      const config = service.getConfig();
      expect(config.swversion).toBe("1941132080");
    });
  });

  describe("getFullConfig", () => {
    it("should extend public config with additional fields", () => {
      const full = service.getFullConfig();
      expect(full.name).toBe("Philips hue"); // inherited from public
      expect(full.ipaddress).toBe("192.168.1.100");
    });

    it("should include network configuration", () => {
      const full = service.getFullConfig();
      expect(full.netmask).toBe("255.255.255.0");
      expect(full.gateway).toBe("192.168.1.1");
      expect(full.dhcp).toBe(true);
    });

    it("should derive gateway from discovery host", () => {
      const svc = new ConfigService({
        identity,
        advertiseHost: "10.20.30.40",
      });
      const full = svc.getFullConfig();
      expect(full.gateway).toBe("10.20.30.1");
    });

    it("should include portal state", () => {
      const full = service.getFullConfig();
      expect(full.portalservices).toBe(true);
      expect(full.portalconnection).toBe("connected");
      expect(full.portalstate).toEqual(
        expect.objectContaining({
          signedon: true,
          incoming: false,
          outgoing: true,
        }),
      );
    });

    it("should have zigbee channel 20", () => {
      const full = service.getFullConfig();
      expect(full.zigbeechannel).toBe(20);
    });

    it("should have linkbutton false by default", () => {
      const full = service.getFullConfig();
      expect(full.linkbutton).toBe(false);
    });

    it("should have empty whitelist by default", () => {
      const full = service.getFullConfig();
      expect(full.whitelist).toEqual({});
    });

    // C6 v1.4.3 — whitelist filled from the provider (paired clients).
    it("fills the whitelist from the whitelistProvider (C6)", () => {
      const svc = new ConfigService({
        identity,
        advertiseHost: "192.168.1.100",
        whitelistProvider: () => ["alexa-1", "harmony-2"],
      });
      const full = svc.getFullConfig();
      expect(Object.keys(full.whitelist!)).toEqual(["alexa-1", "harmony-2"]);
      const entry = full.whitelist!["alexa-1"];
      expect(entry.name).toBe("alexa-1");
      expect(entry["create date"]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(entry["last use date"]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it("a throwing whitelistProvider leaves the whitelist empty (non-fatal)", () => {
      const svc = new ConfigService({
        identity,
        advertiseHost: "192.168.1.100",
        whitelistProvider: () => {
          throw new Error("cache exploded");
        },
      });
      expect(() => svc.getFullConfig()).not.toThrow();
      expect(svc.getFullConfig().whitelist).toEqual({});
    });

    it("should include UTC and localtime strings", () => {
      const full = service.getFullConfig();
      expect(full.UTC).toBeTypeOf("string");
      expect(full.localtime).toBeTypeOf("string");
      // Format: YYYY-MM-DD HH:MM:SS
      expect(full.UTC).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it("formats UTC as the exact spec timestamp for a fixed instant (C3 — value, not just shape)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T12:30:45Z"));
      try {
        expect(service.getFullConfig().UTC).toBe("2024-01-15 12:30:45");
      } finally {
        vi.useRealTimers();
      }
    });

    // C2 v1.4.3 — timezone is the host's IANA zone (Intl-resolved), not the
    // hardcoded "Europe/Berlin" of earlier versions.
    it("should report a real IANA timezone instead of the hardcoded one (C2 v1.4.3)", () => {
      const full = service.getFullConfig();
      // Invariant: an IANA-shaped zone token (e.g. "Europe/Berlin" or "UTC"),
      // asserted as a shape rather than re-derived with the implementation's own
      // expression (which would make the test tautological).
      expect(full.timezone).toMatch(/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)*$/);
    });

    // C3 v1.4.3 — localtime should be in the spec format too.
    it("should produce a spec-shaped localtime string (C3 v1.4.3)", () => {
      const full = service.getFullConfig();
      expect(full.localtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    // C1 v1.4.3 — IPv4-only gateway munge. Previously a non-IPv4 host gave
    // garbage from `replace(/\.\d+$/, ".1")`.
    it("should leave gateway as the host string when host is not IPv4 (C1 v1.4.3)", () => {
      const svc = new ConfigService({
        identity,
        advertiseHost: "fe80::1",
      });
      const full = svc.getFullConfig();
      expect(full.gateway).toBe("fe80::1");
    });
  });

  describe("buildFullState", () => {
    it("should include lights in full state", () => {
      const lights = {
        1: {
          state: { on: true, bri: 254, reachable: true },
          name: "Test Light",
          type: "Dimmable light" as const,
          modelid: "LWB010",
          uniqueid: "00:17:88:01:00:01:01:01-0b",
        },
      };

      const state = service.buildFullState(lights);
      expect(state.lights).toEqual(lights);
    });

    it("should include empty collections for unsupported features", () => {
      const state = service.buildFullState({});
      expect(state.groups).toEqual({});
      expect(state.schedules).toEqual({});
      expect(state.scenes).toEqual({});
      expect(state.rules).toEqual({});
      expect(state.sensors).toEqual({});
      expect(state.resourcelinks).toEqual({});
    });

    it("should include full config", () => {
      const state = service.buildFullState({});
      expect(state.config.name).toBe("Philips hue");
      expect(state.config.ipaddress).toBe("192.168.1.100");
    });
  });
});
