import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

type I18nKey = keyof typeof translations;

/** The eleven languages every ioBroker manifest and admin translation carries. */
const LANGUAGES = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;

/**
 * Translation object for the given i18n key.
 *
 * @param key Translation key from admin/i18n/en.json
 */
export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

/**
 * Translation object for a user-facing string, with optional `%s` interpolation.
 * Returns all 11 languages (via adapter-core `getTranslatedObject`) so
 * Device-Manager titles, confirmations and messages render correctly in every
 * admin language regardless of how the frontend resolves the text.
 *
 * @param key Translation key from admin/i18n/en.json
 * @param args Optional values substituted into the key's `%s` placeholders
 */
export function t(key: I18nKey, ...args: (string | number | boolean | null)[]): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key, ...args);
}

/**
 * Wrap a text that comes from a paired client — the device type it announced
 * itself with, such as `Harmony Hub` — as a translation object.
 *
 * There is nothing to translate (the client sends one string, identical in every
 * language), but `common.name` must be a translation object for every object
 * type, never a bare string (core team, nut2 #15). Offering the same text under
 * every language key makes the object browser show it in any system language
 * instead of falling back on an untranslated name.
 *
 * @param text The client-supplied text
 * @returns The same text under every language key
 */
export function tRaw(text: string): ioBroker.StringOrTranslated {
  return Object.fromEntries(LANGUAGES.map(lang => [lang, text])) as ioBroker.StringOrTranslated;
}
