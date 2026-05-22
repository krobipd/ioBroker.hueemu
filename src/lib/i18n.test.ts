import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { tName } from "./i18n";

describe("tName", () => {
  it("delegates to I18n.getTranslatedObject", () => {
    const result = tName("clientsFolder");
    expect(result).toEqual({ en: "clientsFolder", de: "clientsFolder_de" });
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
