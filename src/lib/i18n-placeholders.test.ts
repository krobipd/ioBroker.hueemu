/**
 * Every translation carries the same `%s` placeholders as its English source.
 *
 * `t()` interpolates positionally: a translation with a placeholder too few
 * silently drops the value (the light's number, the client's name), one with a
 * placeholder too many shows a bare "%s" in the admin. Neither gate sees it —
 * the state-role gate checks that a key EXISTS in en.json, the manifest sync
 * checks the manifest objects — so this is the one test for it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const I18N_DIR = join(__dirname, "..", "..", "admin", "i18n");

function placeholders(text: string): number {
  return (text.match(/%s/g) ?? []).length;
}

describe("admin/i18n placeholder parity", () => {
  const en = JSON.parse(readFileSync(join(I18N_DIR, "en.json"), "utf8")) as Record<string, string>;
  const languages = readdirSync(I18N_DIR)
    .filter(file => file.endsWith(".json") && file !== "en.json")
    .map(file => file.replace(/\.json$/, ""));

  it("covers the ten other languages", () => {
    expect(languages.sort()).toEqual(["de", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh-cn"]);
  });

  it.each(languages)("%s carries every key of en.json with the same number of %%s placeholders", language => {
    const translated = JSON.parse(readFileSync(join(I18N_DIR, `${language}.json`), "utf8")) as Record<string, string>;
    const mismatches = Object.entries(en)
      .map(([key, text]) => {
        const other = translated[key];
        if (other === undefined) {
          return `${key}: missing`;
        }
        return placeholders(other) === placeholders(text)
          ? null
          : `${key}: ${placeholders(other)} ≠ ${placeholders(text)}`;
      })
      .filter((entry): entry is string => entry !== null);
    expect(mismatches).toEqual([]);
    expect(Object.keys(translated).filter(key => !(key in en))).toEqual([]);
  });
});
