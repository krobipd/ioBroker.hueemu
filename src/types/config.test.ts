/**
 * Tests for config utilities and ConfigService
 */

import { generateBridgeId, generateSerialNumber, httpsPortOf, macFromUdn, validateNetworkConfig } from "./config";
import { ConfigService } from "../hue-api/config-service";
import { SettingsError } from "../lib/start-failure";
import { createTestIdentity } from "../../test/test-helpers";

describe("Config utilities", () => {
  describe("macFromUdn", () => {
    it("derives a colon-paired MAC from a UUID (dashes stripped, first 12 hex)", () => {
      expect(macFromUdn("12345678-1234-1234-1234-123456789abc")).toBe("12:34:56:78:12:34");
    });

    it("zero-pads a short UDN to 12 hex chars", () => {
      // First byte 0xab is masked to 0xaa (I/G bit cleared for unicast); the
      // remaining bytes are zero-padded to reach 12 hex chars.
      expect(macFromUdn("ab-cd")).toBe("aa:cd:00:00:00:00");
    });

    it("is deterministic — same UDN yields the same MAC", () => {
      const udn = "12345678-1234-1234-1234-123456789abc";
      expect(macFromUdn(udn)).toBe(macFromUdn(udn));
    });

    it("always yields a locally-administered unicast MAC (I/G bit clear, U/L bit set)", () => {
      // A raw UUID slice can land on a multicast first byte (odd low bit) or a
      // globally-administered one — neither is valid for a device MAC. Cover
      // UUIDs whose first byte would otherwise be multicast, incl. 0x65 (the
      // value that surfaced in krobi's admin as 65:30:f5:41:ec:2e).
      const udns = [
        "6530f541-ec2e-4c1a-9b2d-001122334455", // 0x65 → multicast in the old code
        "ab-cd", // 0xab → multicast
        "ff112233-4455-6677-8899-aabbccddeeff", // 0xff → multicast + global
        "01020304-0506-0708-090a-0b0c0d0e0f10", // 0x01 → multicast
      ];
      for (const udn of udns) {
        const firstByte = parseInt(macFromUdn(udn).split(":")[0], 16);
        expect(firstByte & 0x01).toBe(0); // unicast: I/G bit clear
        expect(firstByte & 0x02).toBe(0x02); // locally administered: U/L bit set
      }
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

  describe("validateNetworkConfig", () => {
    it("passes with no HTTPS port", () => {
      expect(() => validateNetworkConfig(8080, undefined)).not.toThrow();
    });

    it("passes when the HTTPS port differs from the HTTP port", () => {
      expect(() => validateNetworkConfig(8080, 443)).not.toThrow();
    });

    it("throws when the HTTPS port equals the HTTP port", () => {
      expect(() => validateNetworkConfig(8080, 8080)).toThrow(/equals HTTP port/i);
    });

    // v1.18.0 (audit 2026-09-15 E7): only the admin form kept a port in range —
    // a hand-edited instance object could carry 0 or 70000 into listen().
    it("throws for a port outside 1..65535 or not an integer", () => {
      expect(() => validateNetworkConfig(0, undefined)).toThrow(/HTTP port 0 is not a port number/);
      expect(() => validateNetworkConfig(70000, undefined)).toThrow(/not a port number/);
      expect(() => validateNetworkConfig(8080.5, undefined)).toThrow(/not a port number/);
      expect(() => validateNetworkConfig(8080, 65536)).toThrow(/HTTPS port 65536 is not a port number/);
      expect(() => validateNetworkConfig(1, 65535)).not.toThrow();
    });

    // Start-failure standard (krobi 2026-11-11 23:32): a wrong setting ends with exit code 11 and a notification
    // (start-failure.ts `failStart`) — every finding of this check is one.
    it("names a wrong port a settings error", () => {
      expect(() => validateNetworkConfig(70000, undefined)).toThrow(SettingsError);
      expect(() => validateNetworkConfig(8080, 8080)).toThrow(SettingsError);
    });
  });

  // The fleet's HTTPS option (krobi 2026-11-14 19:15): `native.secure` switches HTTPS, the port field alone does not.
  describe("httpsPortOf", () => {
    it("has no HTTPS port while HTTPS is off, whatever the field holds", () => {
      expect(httpsPortOf(false, "443")).toBeUndefined();
      expect(httpsPortOf(false, 8443)).toBeUndefined();
      expect(httpsPortOf(false, "")).toBeUndefined();
    });

    it("takes the field's port while HTTPS is on", () => {
      expect(httpsPortOf(true, "443")).toBe(443);
      expect(httpsPortOf(true, 8443)).toBe(8443);
    });

    it("names HTTPS on without a port a settings error", () => {
      expect(() => httpsPortOf(true, "")).toThrow(SettingsError);
      expect(() => httpsPortOf(true, undefined)).toThrow(/HTTPS is on, but no HTTPS port is set/);
    });
  });
});

describe("ConfigService", () => {
  const identity = createTestIdentity();
  let service: ConfigService;

  beforeEach(() => {
    service = new ConfigService({
      identity,
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
      const full = service.getFullConfig("192.168.1.100");
      expect(full.name).toBe("Philips hue"); // inherited from public
      expect(full.ipaddress).toBe("192.168.1.100");
    });

    it("should include network configuration", () => {
      const full = service.getFullConfig("192.168.1.100");
      expect(full.netmask).toBe("255.255.255.0");
      expect(full.gateway).toBe("192.168.1.1");
      expect(full.dhcp).toBe(true);
    });

    it("should derive gateway from the asking client's address of the host", () => {
      const full = service.getFullConfig("10.20.30.40");
      expect(full.gateway).toBe("10.20.30.1");
    });

    // D17 (krobi 2026-11-11 19:34): without an address for the client the config names none — never one the
    // adapter picked.
    it("names no address and no gateway without an address for the client", () => {
      const full = service.getFullConfig();
      expect(full).not.toHaveProperty("ipaddress");
      expect(full).not.toHaveProperty("gateway");
      expect(full.netmask).toBe("255.255.255.0");
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
    // v1.19.0 (audit 2026-09-25 H5): with the device type as name and the real
    // pairing / last-use time, in the bridge's `YYYY-MM-DDTHH:MM:SS` form.
    it("fills the whitelist from the whitelistProvider (C6)", () => {
      const svc = new ConfigService({
        identity,
        whitelistProvider: () => [
          {
            key: "alexa-1",
            name: "Echo#Kitchen",
            created: Date.UTC(2026, 0, 2, 3, 4, 5),
            lastUse: Date.UTC(2026, 8, 25),
          },
          { key: "harmony-2", name: "harmony#hub", created: 0, lastUse: 0 },
        ],
      });
      const full = svc.getFullConfig();
      expect(Object.keys(full.whitelist!)).toEqual(["alexa-1", "harmony-2"]);
      const entry = full.whitelist!["alexa-1"];
      expect(entry.name).toBe("Echo#Kitchen");
      expect(entry["create date"]).toBe("2026-01-02T03:04:05");
      expect(entry["last use date"]).toBe("2026-09-25T00:00:00");
      // Unknown times fall back to now, still in the bridge's form.
      expect(full.whitelist!["harmony-2"]["create date"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    // v1.19.0 (Q5): a client paired as `__proto__` stays an own entry of the list.
    it("keeps a client named __proto__ in the whitelist", () => {
      const svc = new ConfigService({
        identity,
        whitelistProvider: () => [{ key: "__proto__", name: "x", created: 1, lastUse: 1 }],
      });
      expect(Object.keys(svc.getFullConfig().whitelist!)).toEqual(["__proto__"]);
    });

    it("a throwing whitelistProvider leaves the whitelist empty (non-fatal)", () => {
      const svc = new ConfigService({
        identity,
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
      // Format: YYYY-MM-DDTHH:MM:SS (the bridge's own form, v1.19.0)
      expect(full.UTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    it("formats UTC as the exact spec timestamp for a fixed instant (C3 — value, not just shape)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T12:30:45Z"));
      try {
        expect(service.getFullConfig().UTC).toBe("2024-01-15T12:30:45");
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
      expect(full.localtime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    });

    // N9: midnight is 00, never 24 — red for `hourCycle: "h24"` and for a formatter
    // without an hour cycle ("12"). `hour12: false`, whose "24" N9 was about, renders
    // "00" on the ICU of every supported Node (measured 2026-11-07, ICU 78.2: h23 in
    // en-CA/en-US/de-DE/ja-JP), so no output can tell it from h23 here.
    it("renders midnight as 00, never as 24", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-15T00:00:05Z"));
      try {
        expect(service.getFullConfig().UTC).toBe("2024-01-15T00:00:05");
      } finally {
        vi.useRealTimers();
      }
    });

    // C1 v1.4.3 — IPv4-only gateway munge. Previously a non-IPv4 host gave
    // garbage from `replace(/\.\d+$/, ".1")`.
    it("should leave gateway as the host string when host is not IPv4 (C1 v1.4.3)", () => {
      const full = service.getFullConfig("fe80::1");
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

    it("should include full config with the asking client's address of the host", () => {
      const state = service.buildFullState({}, "192.168.1.100");
      expect(state.config.name).toBe("Philips hue");
      expect(state.config.ipaddress).toBe("192.168.1.100");
    });
  });
});
