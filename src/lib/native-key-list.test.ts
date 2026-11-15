import { buildNativeKeyMigrations } from "./native-key-list";
import { buildCommonKeyPatch, buildNativeKeyPatch } from "./native-key-migration";

const LOCAL = ["192.168.1.20", "10.1.2.3"];

/**
 * The patch the fleet helper computes for this native under hueemu's list.
 *
 * @param native the instance's native settings
 * @param local the IPv4 addresses the host carries
 * @param lightsStored whether every light of the settings is a light object
 * @param identityNew whether this start wrote the identity file first
 */
function patchFor(
  native: Record<string, unknown>,
  local: readonly string[] = LOCAL,
  lightsStored = false,
  identityNew = false,
): Record<string, unknown> {
  return buildNativeKeyPatch(native, buildNativeKeyMigrations(native, local, lightsStored, identityNew));
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

  it("nulls the common keys earlier manifests declared, and only the misspelt connectionType", () => {
    const common = {
      name: "hueemu",
      title: "Hue Emulator",
      license: "MIT",
      main: "build/main.js",
      supportCustoms: false,
      materialize: true,
      connectionType: "local",
      "connectionType ": "local",
    };
    expect(buildCommonKeyPatch(common, buildNativeKeyMigrations({}, LOCAL, false, false))).toEqual({
      license: null,
      main: null,
      supportCustoms: null,
      materialize: null,
      "connectionType ": null,
    });
  });

  it("touches no common key on a current installation", () => {
    expect(
      buildCommonKeyPatch(
        { name: "hueemu", title: "Hue Emulator", connectionType: "local", licenseInformation: { license: "MIT" } },
        buildNativeKeyMigrations({}, LOCAL, false, false),
      ),
    ).toEqual({});
  });

  it("leaves already nulled keys alone — the second start writes nothing", () => {
    expect(
      patchFor({ bind: "10.1.2.3", port: 8080, host: null, advertiseHost: null, discoveryHost: null, upnpPort: null }),
    ).toEqual({});
  });

  // Audit R-24: the identity moved to the data folder — dropped from native only once the file holds it: a start that
  // cannot read or store the file stops before the migrations (main.ts loadIdentity, S9).
  const IDENTITY_IN_NATIVE = {
    bind: "0.0.0.0",
    port: 8080,
    udn: "12345678-1234-1234-1234-123456789abc",
    mac: "AA:BB:CC:DD:EE:FF",
    tlsCert: "-----BEGIN CERTIFICATE-----",
    tlsKey: "$/aes-192-cbc:00:11",
  };

  it("drops udn, tlsCert and tlsKey — the MAC stays a setting", () => {
    expect(patchFor(IDENTITY_IN_NATIVE, LOCAL)).toEqual({ udn: null, tlsCert: null, tlsKey: null });
  });

  // The fleet's HTTPS option (krobi 2026-11-14 19:15): up to v1.19.0 a set httpsPort alone served HTTPS. On the first
  // start of this version — the identity file is new, or the own certificate still sits in native — it turns `secure`
  // on, in the same write that drops the certificate; js-controller added `secure: false` with the update.
  it("switches HTTPS on for an installation of v1.19.0 that served it, in the write that drops its certificate", () => {
    const updated = { ...IDENTITY_IN_NATIVE, httpsPort: "443", secure: false };
    expect(patchFor(updated, LOCAL)).toEqual({ secure: true, udn: null, tlsCert: null, tlsKey: null });
    expect(patchFor(updated, LOCAL, false, true)).toEqual({ secure: true, udn: null, tlsCert: null, tlsKey: null });
  });

  it("switches HTTPS on for an older installation without a stored certificate — its identity file is new", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, httpsPort: 443, secure: false }, LOCAL, false, true)).toEqual({
      secure: true,
    });
  });

  it("leaves HTTPS off when the update finds no HTTPS port", () => {
    expect(patchFor({ ...IDENTITY_IN_NATIVE, httpsPort: "", secure: false }, LOCAL, false, true)).toEqual({
      udn: null,
      tlsCert: null,
      tlsKey: null,
    });
  });

  // Once the first start of this version is done, the identity file is there and the certificate gone: a user who
  // switches HTTPS off and leaves the port is never switched on again.
  it("never switches HTTPS on again once the user switched it off", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, httpsPort: "443", secure: false, tlsCert: null }, LOCAL)).toEqual(
      {},
    );
  });

  // Audit R-24: the lights moved to their own objects — dropped from native only once every one is stored there.
  const LIGHTS_IN_NATIVE = {
    bind: "0.0.0.0",
    port: 8080,
    devices: [{ id: 1, name: "Kitchen", lightType: "onoff", onState: "0_userdata.0.kitchen" }],
    lastLightId: 3,
  };

  it("drops devices and lastLightId once every light is a light object", () => {
    expect(patchFor(LIGHTS_IN_NATIVE, LOCAL, true)).toEqual({ devices: null, lastLightId: null });
  });

  it("drops the manifest's empty list and zero mark as well", () => {
    expect(patchFor({ bind: "0.0.0.0", port: 8080, devices: [], lastLightId: 0 }, LOCAL, true)).toEqual({
      devices: null,
      lastLightId: null,
    });
  });

  it("keeps the lights in native while they are not all stored as objects", () => {
    expect(patchFor(LIGHTS_IN_NATIVE, LOCAL, false)).toEqual({});
  });
});
