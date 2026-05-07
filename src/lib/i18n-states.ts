/**
 * Localized state and channel names for the Hue emulator's own ioBroker
 * objects in 11 ioBroker system languages.
 *
 * Scope is small: clients folder + startPairing/disableAuth state names
 * and descriptions. Hue API protocol strings (LIGHT_TYPES.name, productname,
 * manufacturername) MUST stay English (Hue API specification).
 *
 * ioBroker accepts plain strings or `{ en, de, ... }` translation objects for
 * `common.name`/`common.desc`. Admin, vis and the Object-Browser pick the
 * user's language automatically — we just hand them the object.
 */

type Lang = "en" | "de" | "ru" | "pt" | "nl" | "fr" | "it" | "es" | "pl" | "uk" | "zh-cn";

/** Translation object as ioBroker expects it. */
export type StateName = Record<Lang, string>;

/** State / channel display names + descriptions. */
export const STATE_NAMES: Record<string, StateName> = {
  // ──────── Clients folder ────────
  clientsFolder: {
    en: "Paired Clients",
    de: "Verbundene Clients",
    ru: "Связанные клиенты",
    pt: "Clientes emparelhados",
    nl: "Gekoppelde clients",
    fr: "Clients appariés",
    it: "Client accoppiati",
    es: "Clientes emparejados",
    pl: "Sparowane klienty",
    uk: "Спарені клієнти",
    "zh-cn": "已配对客户端",
  },

  // ──────── startPairing button ────────
  startPairingName: {
    en: "Start Pairing",
    de: "Pairing starten",
    ru: "Начать сопряжение",
    pt: "Iniciar emparelhamento",
    nl: "Koppelen starten",
    fr: "Démarrer l'appairage",
    it: "Avvia accoppiamento",
    es: "Iniciar emparejamiento",
    pl: "Rozpocznij parowanie",
    uk: "Почати спарювання",
    "zh-cn": "开始配对",
  },
  startPairingDesc: {
    en: "Enable pairing mode for 50 seconds",
    de: "Pairing-Modus für 50 Sekunden aktivieren",
    ru: "Включить режим сопряжения на 50 секунд",
    pt: "Ativar modo de emparelhamento por 50 segundos",
    nl: "Koppelmodus 50 seconden activeren",
    fr: "Activer le mode d'appairage pendant 50 secondes",
    it: "Attiva la modalità accoppiamento per 50 secondi",
    es: "Activar el modo de emparejamiento durante 50 segundos",
    pl: "Włącz tryb parowania na 50 sekund",
    uk: "Увімкнути режим спарювання на 50 секунд",
    "zh-cn": "启用配对模式 50 秒",
  },

  // ──────── disableAuth switch ────────
  disableAuthName: {
    en: "Disable Authentication",
    de: "Authentifizierung deaktivieren",
    ru: "Отключить аутентификацию",
    pt: "Desativar autenticação",
    nl: "Aanmelding uitschakelen",
    fr: "Désactiver l'authentification",
    it: "Disattiva autenticazione",
    es: "Desactivar autenticación",
    pl: "Wyłącz uwierzytelnianie",
    uk: "Вимкнути автентифікацію",
    "zh-cn": "禁用身份验证",
  },
  disableAuthDesc: {
    en: "Disable authentication (allow all requests)",
    de: "Authentifizierung deaktivieren (alle Anfragen erlauben)",
    ru: "Отключить аутентификацию (разрешить все запросы)",
    pt: "Desativar autenticação (permitir todos os pedidos)",
    nl: "Aanmelding uitschakelen (alle aanvragen toestaan)",
    fr: "Désactiver l'authentification (autoriser toutes les requêtes)",
    it: "Disattiva l'autenticazione (consenti tutte le richieste)",
    es: "Desactivar autenticación (permitir todas las solicitudes)",
    pl: "Wyłącz uwierzytelnianie (zezwalaj na wszystkie żądania)",
    uk: "Вимкнути автентифікацію (дозволити всі запити)",
    "zh-cn": "禁用身份验证（允许所有请求）",
  },
};

/**
 * Translation object for a state name. Pass into `common.name` or `common.desc`;
 * ioBroker Admin/vis/Object-Browser localizes automatically.
 *
 * @param key Translation key in {@link STATE_NAMES}.
 */
export function tName(key: keyof typeof STATE_NAMES): StateName {
  return STATE_NAMES[key];
}
