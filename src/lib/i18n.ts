import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

type I18nKey = keyof typeof translations;

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
