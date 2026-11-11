import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { I18n } from "@iobroker/adapter-core";
import { nameIn, t, tName } from "./i18n";

describe("tName", () => {
  it("delegates to I18n.getTranslatedObject", () => {
    const result = tName("clientsFolder");
    expect(result).toEqual({ en: "clientsFolder", de: "clientsFolder_de" });
  });
});

describe("t", () => {
  it("forwards the key and the %s arguments to I18n.getTranslatedObject", () => {
    const result = t("dmScanAddedSkipped", 3, 1);
    expect(vi.mocked(I18n.getTranslatedObject)).toHaveBeenCalledWith("dmScanAddedSkipped", 3, 1);
    expect(result).toEqual({ en: "dmScanAddedSkipped", de: "dmScanAddedSkipped_de" });
  });
});

describe("nameIn", () => {
  it("takes a text as it is", () => {
    expect(nameIn("Desk", "de")).toBe("Desk");
  });

  it("reads a translation object in the language, else in English", () => {
    expect(nameIn({ en: "Hall", de: "Flur" }, "de")).toBe("Flur");
    expect(nameIn({ en: "Hall", de: "Flur" }, "fr")).toBe("Hall");
    expect(nameIn({ en: "Hall", de: "" }, "de")).toBe("Hall");
    expect(nameIn({ en: "Hall" }, undefined)).toBe("Hall");
  });

  // A hand-edited object: a name that is no text, or a translation without one — the caller gets "".
  it("gives an empty text for a name it cannot read", () => {
    expect(nameIn(undefined, "en")).toBe("");
    expect(nameIn(42, "en")).toBe("");
    expect(nameIn({ de: 7 }, "de")).toBe("");
    expect(nameIn({}, "en")).toBe("");
  });
});

describe("i18n completeness", () => {
  const i18nDir = join(__dirname, "../../admin/i18n");
  const files = readdirSync(i18nDir).filter(f => f.endsWith(".json"));
  const keysets = files.map(f => ({
    lang: f.replace(".json", ""),
    keys: Object.keys(JSON.parse(readFileSync(join(i18nDir, f), "utf8"))),
  }));
  const enKeys = keysets.find(k => k.lang === "en")!.keys;

  it("all 11 languages present", () => {
    expect(files).toHaveLength(11);
  });

  it("all languages have identical keysets", () => {
    for (const { lang, keys } of keysets) {
      expect(keys, `${lang} keyset mismatch`).toEqual(enKeys);
    }
  });

  it("state name keys are present", () => {
    expect(enKeys).toContain("clientsFolder");
    expect(enKeys).toContain("startPairingName");
    expect(enKeys).toContain("startPairingDesc");
    expect(enKeys).toContain("disableAuthName");
    expect(enKeys).toContain("disableAuthDesc");
  });
});
