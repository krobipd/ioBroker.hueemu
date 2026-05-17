import { STATE_NAMES, tName } from "./i18n-states";

const SUPPORTED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;

describe("i18n-states", () => {
  describe("tName", () => {
    it("returns a translation object for clientsFolder", () => {
      const obj = tName("clientsFolder");
      expect(obj.en).toBe("Paired Clients");
      expect(obj.de).toBe("Verbundene Clients");
    });

    it("returns a translation object for startPairingName + startPairingDesc", () => {
      expect(tName("startPairingName").en).toBe("Start Pairing");
      expect(tName("startPairingDesc").de).toBe("Pairing-Modus für 50 Sekunden aktivieren");
    });

    it("returns a translation object for disableAuthName + disableAuthDesc", () => {
      expect(tName("disableAuthName").en).toBe("Disable Authentication");
      expect(tName("disableAuthDesc").en).toBe("Disable authentication (allow all requests)");
    });
  });

  describe("STATE_NAMES coverage", () => {
    it("includes the migration-helper keys (load-bearing for v1.3 → v1.4 upgrade)", () => {
      const requiredKeys = [
        "clientsFolder",
        "startPairingName",
        "startPairingDesc",
        "disableAuthName",
        "disableAuthDesc",
      ];
      for (const key of requiredKeys) {
        expect(STATE_NAMES[key]).toBeDefined();
      }
    });

    it("covers every key in all 11 supported languages", () => {
      for (const key of Object.keys(STATE_NAMES)) {
        const bundle = STATE_NAMES[key];
        for (const lang of SUPPORTED_LANGS) {
          expect(bundle[lang]).toBeDefined();
          expect(bundle[lang].length).toBeGreaterThan(0);
        }
      }
    });
  });
});
