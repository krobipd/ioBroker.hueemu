import { buildNativeKeyMigrations } from "./native-key-list";
import { buildNativeKeyPatch } from "./native-key-migration";

const LOCAL = ["192.168.1.20", "10.1.2.3"];

/**
 * The patch the fleet helper computes for this native under hueemu's list.
 *
 * @param native the instance's native settings
 * @param local the IPv4 addresses the host carries
 */
function patchFor(native: Record<string, unknown>, local: readonly string[] = LOCAL): Record<string, unknown> {
  return buildNativeKeyPatch(native, buildNativeKeyMigrations(native, local));
}

describe("buildNativeKeyMigrations", () => {
  it("writes nothing on a current installation", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080 })).toEqual({});
  });

  it("still carries a pre-1.18 host and string port over", () => {
    expect(patchFor({ host: "192.168.1.20", bind: "0.0.0.0", port: "8080" })).toEqual({
      bind: "192.168.1.20",
      host: null,
      port: 8080,
    });
  });

  it("moves a live advertiseHost into bind when the instance listens everywhere", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, advertiseHost: "10.1.2.3" })).toEqual({
      bind: "10.1.2.3",
      advertiseHost: null,
    });
  });

  it("moves it over an empty legacy host too (update straight from 1.12–1.17)", () => {
    expect(patchFor({ host: "", bind: "0.0.0.0", port: 8080, advertiseHost: "10.1.2.3" })).toEqual({
      bind: "10.1.2.3",
      host: null,
      advertiseHost: null,
    });
  });

  it("drops an advertiseHost this host no longer carries — a stale address would bind nowhere", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, advertiseHost: "172.16.9.9" })).toEqual({ advertiseHost: null });
  });

  it("never overrides an address the user chose later", () => {
    expect(patchFor({ bind: "192.168.1.20", port: 8080, advertiseHost: "10.1.2.3" })).toEqual({
      advertiseHost: null,
    });
    expect(patchFor({ host: "192.168.1.20", bind: "0.0.0.0", port: 8080, advertiseHost: "10.1.2.3" })).toEqual({
      bind: "192.168.1.20",
      host: null,
      advertiseHost: null,
    });
  });

  it("drops an empty or wildcard advertiseHost", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, advertiseHost: "" })).toEqual({ advertiseHost: null });
    expect(patchFor({ bind: "0.0.0.0", port: 8080, advertiseHost: "0.0.0.0" })).toEqual({ advertiseHost: null });
  });

  it("drops the keys no version reads any more", () => {
    expect(
      patchFor({ bind: "0.0.0.0", port: 8080, discoveryHost: "192.168.178.10", discoveryPort: 80, upnpPort: 1900 }),
    ).toEqual({ discoveryHost: null, discoveryPort: null, upnpPort: null });
  });

  it("leaves already nulled keys alone — the second start writes nothing", () => {
    expect(
      patchFor({ bind: "10.1.2.3", port: 8080, host: null, advertiseHost: null, discoveryHost: null, upnpPort: null }),
    ).toEqual({});
  });
});
