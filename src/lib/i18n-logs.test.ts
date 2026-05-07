import { expect } from "chai";
import { LOG_STRINGS, tLog } from "./i18n-logs";

const SUPPORTED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;

describe("i18n-logs", () => {
  describe("tLog", () => {
    it("returns the EN template when lang is 'en'", () => {
      expect(tLog("en", "pairingDisabled")).to.equal("Pairing mode disabled");
    });

    it("returns the DE template when lang is 'de'", () => {
      expect(tLog("de", "pairingDisabled")).to.equal("Pairing-Modus deaktiviert");
    });

    it("falls back to EN for unknown language codes", () => {
      expect(tLog("klingon", "pairingDisabled")).to.equal("Pairing mode disabled");
    });

    it("substitutes {key} tokens from params", () => {
      expect(
        tLog("en", "clientPaired", {
          devicetype: "Echo#krobi",
          username: "abc123",
        }),
      ).to.equal('Paired client "Echo#krobi" as user abc123');
    });

    it("renders null params as '(none)'", () => {
      expect(tLog("en", "ssdpError", { error: null })).to.equal("SSDP error: (none)");
    });

    it("keeps the literal {key} when a param is undefined", () => {
      expect(tLog("en", "shutdownError", {})).to.equal("Error during shutdown: {error}");
    });

    it("returns the template unchanged when no params are passed", () => {
      expect(tLog("en", "authEnabled")).to.equal("Authentication enabled");
    });

    it("covers every key in all 11 supported languages", () => {
      for (const key of Object.keys(LOG_STRINGS) as Array<keyof typeof LOG_STRINGS>) {
        const bundle = LOG_STRINGS[key];
        for (const lang of SUPPORTED_LANGS) {
          expect(bundle[lang], `missing ${lang} translation for ${key}`).to.be.a("string").and.not.empty;
        }
      }
    });
  });
});
