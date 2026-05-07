"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var i18n_logs_exports = {};
__export(i18n_logs_exports, {
  LOG_STRINGS: () => LOG_STRINGS,
  tLog: () => tLog
});
module.exports = __toCommonJS(i18n_logs_exports);
const SUPPORTED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];
function fmt(template, params) {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = params[key];
    if (v === null) {
      return "(none)";
    }
    if (v === void 0) {
      return `{${key}}`;
    }
    return String(v);
  });
}
const LOG_STRINGS = {
  // ──────── Adapter lifecycle / crash defense ────────
  onReadyFailed: {
    en: "onReady failed: {error}",
    de: "onReady fehlgeschlagen: {error}",
    ru: "onReady \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u043B\u0441\u044F \u0441 \u043E\u0448\u0438\u0431\u043A\u043E\u0439: {error}",
    pt: "onReady falhou: {error}",
    nl: "onReady is mislukt: {error}",
    fr: "onReady a \xE9chou\xE9 : {error}",
    it: "onReady non riuscito: {error}",
    es: "onReady fall\xF3: {error}",
    pl: "onReady nie powi\xF3d\u0142 si\u0119: {error}",
    uk: "onReady \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0432\u0441\u044F \u0437 \u043F\u043E\u043C\u0438\u043B\u043A\u043E\u044E: {error}",
    "zh-cn": "onReady \u5931\u8D25\uFF1A{error}"
  },
  unhandledRejection: {
    en: "Unhandled rejection: {error}",
    de: "Unbehandelte Promise-Rejection: {error}",
    ru: "\u041D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u044B\u0439 rejection: {error}",
    pt: "Rejei\xE7\xE3o n\xE3o tratada: {error}",
    nl: "Onafgehandelde rejection: {error}",
    fr: "Rejet non g\xE9r\xE9 : {error}",
    it: "Rejection non gestita: {error}",
    es: "Rechazo no manejado: {error}",
    pl: "Nieobs\u0142u\u017Cone odrzucenie: {error}",
    uk: "\u041D\u0435\u043E\u0431\u0440\u043E\u0431\u043B\u0435\u043D\u0438\u0439 rejection: {error}",
    "zh-cn": "\u672A\u5904\u7406\u7684 rejection\uFF1A{error}"
  },
  uncaughtException: {
    en: "Uncaught exception: {error}",
    de: "Nicht abgefangene Exception: {error}",
    ru: "\u041D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u043E\u0435 \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: {error}",
    pt: "Exce\xE7\xE3o n\xE3o capturada: {error}",
    nl: "Niet-opgevangen exception: {error}",
    fr: "Exception non captur\xE9e : {error}",
    it: "Eccezione non catturata: {error}",
    es: "Excepci\xF3n no capturada: {error}",
    pl: "Nieprzechwycony wyj\u0105tek: {error}",
    uk: "\u041D\u0435\u043F\u0435\u0440\u0435\u0445\u043E\u043F\u043B\u0435\u043D\u0435 \u0432\u0438\u043A\u043B\u044E\u0447\u0435\u043D\u043D\u044F: {error}",
    "zh-cn": "\u672A\u6355\u83B7\u7684\u5F02\u5E38\uFF1A{error}"
  },
  startupFailed: {
    en: "Failed to start Hue Emulator: {error}",
    de: "Hue-Emulator konnte nicht gestartet werden: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C Hue-\u044D\u043C\u0443\u043B\u044F\u0442\u043E\u0440: {error}",
    pt: "Falha ao iniciar o emulador Hue: {error}",
    nl: "Starten van Hue-emulator mislukt: {error}",
    fr: "Impossible de d\xE9marrer l'\xE9mulateur Hue : {error}",
    it: "Impossibile avviare l'emulatore Hue: {error}",
    es: "No se pudo iniciar el emulador Hue: {error}",
    pl: "Nie uda\u0142o si\u0119 uruchomi\u0107 emulatora Hue: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0438 Hue-\u0435\u043C\u0443\u043B\u044F\u0442\u043E\u0440: {error}",
    "zh-cn": "\u65E0\u6CD5\u542F\u52A8 Hue \u6A21\u62DF\u5668\uFF1A{error}"
  },
  shutdownError: {
    en: "Error during shutdown: {error}",
    de: "Fehler beim Beenden: {error}",
    ru: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u0438: {error}",
    pt: "Erro durante o encerramento: {error}",
    nl: "Fout tijdens afsluiten: {error}",
    fr: "Erreur lors de l'arr\xEAt : {error}",
    it: "Errore durante l'arresto: {error}",
    es: "Error durante el apagado: {error}",
    pl: "B\u0142\u0105d podczas zamykania: {error}",
    uk: "\u041F\u043E\u043C\u0438\u043B\u043A\u0430 \u043F\u0456\u0434 \u0447\u0430\u0441 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043D\u044F: {error}",
    "zh-cn": "\u5173\u673A\u65F6\u51FA\u9519\uFF1A{error}"
  },
  serverStopError: {
    en: "Server stop error: {error}",
    de: "Fehler beim Stoppen des Servers: {error}",
    ru: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043A\u0435 \u0441\u0435\u0440\u0432\u0435\u0440\u0430: {error}",
    pt: "Erro ao parar o servidor: {error}",
    nl: "Fout bij stoppen van server: {error}",
    fr: "Erreur d'arr\xEAt du serveur : {error}",
    it: "Errore di arresto del server: {error}",
    es: "Error al detener el servidor: {error}",
    pl: "B\u0142\u0105d zatrzymania serwera: {error}",
    uk: "\u041F\u043E\u043C\u0438\u043B\u043A\u0430 \u0437\u0443\u043F\u0438\u043D\u043A\u0438 \u0441\u0435\u0440\u0432\u0435\u0440\u0430: {error}",
    "zh-cn": "\u670D\u52A1\u5668\u505C\u6B62\u9519\u8BEF\uFF1A{error}"
  },
  // ──────── Startup / runtime ────────
  hueEmulatorStarted: {
    en: "Hue Emulator running on {host}:{port}{httpsPart}, {count} device(s)",
    de: "Hue-Emulator l\xE4uft auf {host}:{port}{httpsPart}, {count} Ger\xE4t(e)",
    ru: "Hue-\u044D\u043C\u0443\u043B\u044F\u0442\u043E\u0440 \u0437\u0430\u043F\u0443\u0449\u0435\u043D \u043D\u0430 {host}:{port}{httpsPart}, {count} \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432(\u0430)",
    pt: "Emulador Hue em execu\xE7\xE3o em {host}:{port}{httpsPart}, {count} dispositivo(s)",
    nl: "Hue-emulator actief op {host}:{port}{httpsPart}, {count} apparaat/apparaten",
    fr: "\xC9mulateur Hue en cours sur {host}:{port}{httpsPart}, {count} appareil(s)",
    it: "Emulatore Hue in esecuzione su {host}:{port}{httpsPart}, {count} dispositivo/i",
    es: "Emulador Hue en marcha en {host}:{port}{httpsPart}, {count} dispositivo(s)",
    pl: "Emulator Hue dzia\u0142a na {host}:{port}{httpsPart}, {count} urz\u0105dzeni(e/a)",
    uk: "Hue-\u0435\u043C\u0443\u043B\u044F\u0442\u043E\u0440 \u043F\u0440\u0430\u0446\u044E\u0454 \u043D\u0430 {host}:{port}{httpsPart}, {count} \u043F\u0440\u0438\u0441\u0442\u0440(\u0456\u0439/\u043E\u0457)",
    "zh-cn": "Hue \u6A21\u62DF\u5668\u8FD0\u884C\u4E8E {host}:{port}{httpsPart}\uFF0C{count} \u4E2A\u8BBE\u5907"
  },
  // ──────── Auth toggle ────────
  authDisabled: {
    en: "Authentication disabled (all requests allowed)",
    de: "Authentifizierung deaktiviert (alle Anfragen erlaubt)",
    ru: "\u0410\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F \u043E\u0442\u043A\u043B\u044E\u0447\u0435\u043D\u0430 (\u0432\u0441\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u044B)",
    pt: "Autentica\xE7\xE3o desativada (todos os pedidos permitidos)",
    nl: "Aanmelding uitgeschakeld (alle aanvragen toegestaan)",
    fr: "Authentification d\xE9sactiv\xE9e (toutes les requ\xEAtes autoris\xE9es)",
    it: "Autenticazione disattivata (tutte le richieste consentite)",
    es: "Autenticaci\xF3n desactivada (se permiten todas las solicitudes)",
    pl: "Uwierzytelnianie wy\u0142\u0105czone (wszystkie \u017C\u0105dania dozwolone)",
    uk: "\u0410\u0432\u0442\u0435\u043D\u0442\u0438\u0444\u0456\u043A\u0430\u0446\u0456\u044E \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E (\u0432\u0441\u0456 \u0437\u0430\u043F\u0438\u0442\u0438 \u0434\u043E\u0437\u0432\u043E\u043B\u0435\u043D\u0456)",
    "zh-cn": "\u8EAB\u4EFD\u9A8C\u8BC1\u5DF2\u7981\u7528\uFF08\u5141\u8BB8\u6240\u6709\u8BF7\u6C42\uFF09"
  },
  authEnabled: {
    en: "Authentication enabled",
    de: "Authentifizierung aktiviert",
    ru: "\u0410\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430",
    pt: "Autentica\xE7\xE3o ativada",
    nl: "Aanmelding ingeschakeld",
    fr: "Authentification activ\xE9e",
    it: "Autenticazione attivata",
    es: "Autenticaci\xF3n activada",
    pl: "Uwierzytelnianie w\u0142\u0105czone",
    uk: "\u0410\u0432\u0442\u0435\u043D\u0442\u0438\u0444\u0456\u043A\u0430\u0446\u0456\u044E \u0443\u0432\u0456\u043C\u043A\u043D\u0435\u043D\u043E",
    "zh-cn": "\u8EAB\u4EFD\u9A8C\u8BC1\u5DF2\u542F\u7528"
  },
  // ──────── Pairing ────────
  pairingEnabled: {
    en: "Pairing mode enabled \u2014 waiting for client to connect ({seconds} seconds)",
    de: "Pairing-Modus aktiv \u2014 warte auf Verbindung eines Clients ({seconds} Sekunden)",
    ru: "\u0420\u0435\u0436\u0438\u043C \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0451\u043D \u2014 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 ({seconds} \u0441\u0435\u043A\u0443\u043D\u0434)",
    pt: "Modo de emparelhamento ativo \u2014 aguardando liga\xE7\xE3o do cliente ({seconds} segundos)",
    nl: "Koppelmodus actief \u2014 wachten op clientverbinding ({seconds} seconden)",
    fr: "Mode d'appairage activ\xE9 \u2014 en attente d'un client ({seconds} secondes)",
    it: "Modalit\xE0 accoppiamento attiva \u2014 attesa di un client ({seconds} secondi)",
    es: "Modo de emparejamiento activo \u2014 esperando cliente ({seconds} segundos)",
    pl: "Tryb parowania aktywny \u2014 oczekiwanie na klienta ({seconds} sekund)",
    uk: "\u0420\u0435\u0436\u0438\u043C \u0441\u043F\u0430\u0440\u044E\u0432\u0430\u043D\u043D\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u0438\u0439 \u2014 \u043E\u0447\u0456\u043A\u0443\u0432\u0430\u043D\u043D\u044F \u043A\u043B\u0456\u0454\u043D\u0442\u0430 ({seconds} \u0441\u0435\u043A\u0443\u043D\u0434)",
    "zh-cn": "\u914D\u5BF9\u6A21\u5F0F\u5DF2\u542F\u7528 \u2014 \u7B49\u5F85\u5BA2\u6237\u7AEF\u8FDE\u63A5\uFF08{seconds} \u79D2\uFF09"
  },
  pairingDisabled: {
    en: "Pairing mode disabled",
    de: "Pairing-Modus deaktiviert",
    ru: "\u0420\u0435\u0436\u0438\u043C \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u044F \u043E\u0442\u043A\u043B\u044E\u0447\u0451\u043D",
    pt: "Modo de emparelhamento desativado",
    nl: "Koppelmodus uitgeschakeld",
    fr: "Mode d'appairage d\xE9sactiv\xE9",
    it: "Modalit\xE0 accoppiamento disattivata",
    es: "Modo de emparejamiento desactivado",
    pl: "Tryb parowania wy\u0142\u0105czony",
    uk: "\u0420\u0435\u0436\u0438\u043C \u0441\u043F\u0430\u0440\u044E\u0432\u0430\u043D\u043D\u044F \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E",
    "zh-cn": "\u914D\u5BF9\u6A21\u5F0F\u5DF2\u7981\u7528"
  },
  pairingTimeout: {
    en: "Pairing mode automatically disabled after {seconds} seconds timeout",
    de: "Pairing-Modus nach {seconds} Sekunden Timeout automatisch deaktiviert",
    ru: "\u0420\u0435\u0436\u0438\u043C \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u043A\u043B\u044E\u0447\u0451\u043D \u043F\u043E \u0442\u0430\u0439\u043C\u0430\u0443\u0442\u0443 ({seconds} \u0441)",
    pt: "Modo de emparelhamento desativado automaticamente ap\xF3s {seconds} segundos",
    nl: "Koppelmodus automatisch uitgeschakeld na {seconds} seconden time-out",
    fr: "Mode d'appairage d\xE9sactiv\xE9 automatiquement apr\xE8s {seconds} secondes de timeout",
    it: "Modalit\xE0 accoppiamento disattivata automaticamente dopo {seconds} secondi di timeout",
    es: "Modo de emparejamiento desactivado autom\xE1ticamente tras {seconds} segundos",
    pl: "Tryb parowania automatycznie wy\u0142\u0105czony po up\u0142ywie {seconds} sekund",
    uk: "\u0420\u0435\u0436\u0438\u043C \u0441\u043F\u0430\u0440\u044E\u0432\u0430\u043D\u043D\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u043D\u043E \u0432\u0438\u043C\u043A\u043D\u0435\u043D\u043E \u043F\u0456\u0441\u043B\u044F {seconds} \u0441 \u0442\u0430\u0439\u043C-\u0430\u0443\u0442\u0443",
    "zh-cn": "\u914D\u5BF9\u6A21\u5F0F\u5728 {seconds} \u79D2\u8D85\u65F6\u540E\u81EA\u52A8\u7981\u7528"
  },
  clientPaired: {
    en: 'Paired client "{devicetype}" as user {username}',
    de: 'Client "{devicetype}" gepaart als Benutzer {username}',
    ru: '\u041A\u043B\u0438\u0435\u043D\u0442 "{devicetype}" \u0441\u043E\u043F\u0440\u044F\u0436\u0451\u043D \u043A\u0430\u043A \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C {username}',
    pt: 'Cliente "{devicetype}" emparelhado como utilizador {username}',
    nl: 'Client "{devicetype}" gekoppeld als gebruiker {username}',
    fr: `Client "{devicetype}" appair\xE9 en tant qu'utilisateur {username}`,
    it: 'Client "{devicetype}" accoppiato come utente {username}',
    es: 'Cliente "{devicetype}" emparejado como usuario {username}',
    pl: 'Klient "{devicetype}" sparowany jako u\u017Cytkownik {username}',
    uk: '\u041A\u043B\u0456\u0454\u043D\u0442\u0430 "{devicetype}" \u0441\u043F\u0430\u0440\u0435\u043D\u043E \u044F\u043A \u043A\u043E\u0440\u0438\u0441\u0442\u0443\u0432\u0430\u0447\u0430 {username}',
    "zh-cn": '\u5DF2\u914D\u5BF9\u5BA2\u6237\u7AEF "{devicetype}"\uFF0C\u7528\u6237\u540D {username}'
  },
  // ──────── Migration ────────
  legacyMigrationStart: {
    en: "Found {count} legacy device(s) \u2014 migrating to new configuration",
    de: "{count} alte(s) Ger\xE4t(e) gefunden \u2014 Migration zur neuen Konfiguration l\xE4uft",
    ru: "\u041D\u0430\u0439\u0434\u0435\u043D\u043E {count} \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448(\u0435\u0435/\u0438\u0445) \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432(\u043E/\u0430) \u2014 \u043C\u0438\u0433\u0440\u0430\u0446\u0438\u044F \u043D\u0430 \u043D\u043E\u0432\u0443\u044E \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u044E",
    pt: "Encontrado(s) {count} dispositivo(s) antigo(s) \u2014 migrando para nova configura\xE7\xE3o",
    nl: "{count} oud(e) apparaat/apparaten gevonden \u2014 migratie naar nieuwe configuratie",
    fr: "{count} appareil(s) ancien(s) trouv\xE9(s) \u2014 migration vers la nouvelle configuration",
    it: "Trovato/i {count} dispositivo/i precedente/i \u2014 migrazione alla nuova configurazione",
    es: "Encontrado(s) {count} dispositivo(s) antiguo(s) \u2014 migrando a la nueva configuraci\xF3n",
    pl: "Znaleziono {count} stary(ch) urz\u0105dze\u0144 \u2014 migracja do nowej konfiguracji",
    uk: "\u0417\u043D\u0430\u0439\u0434\u0435\u043D\u043E {count} \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0438\u0445 \u043F\u0440\u0438\u0441\u0442\u0440(\u0456\u0439/\u043E\u0457) \u2014 \u043C\u0456\u0433\u0440\u0430\u0446\u0456\u044F \u0434\u043E \u043D\u043E\u0432\u043E\u0457 \u043A\u043E\u043D\u0444\u0456\u0433\u0443\u0440\u0430\u0446\u0456\u0457",
    "zh-cn": "\u53D1\u73B0 {count} \u4E2A\u65E7\u8BBE\u5907 \u2014 \u6B63\u8FC1\u79FB\u5230\u65B0\u914D\u7F6E"
  },
  legacyMigrationItem: {
    en: 'Migrated legacy device "{name}" as {lightType}',
    de: 'Altes Ger\xE4t "{name}" als {lightType} migriert',
    ru: '\u0423\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0435\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E "{name}" \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E \u043A\u0430\u043A {lightType}',
    pt: 'Dispositivo antigo "{name}" migrado como {lightType}',
    nl: 'Oud apparaat "{name}" gemigreerd als {lightType}',
    fr: 'Ancien appareil "{name}" migr\xE9 en tant que {lightType}',
    it: 'Dispositivo precedente "{name}" migrato come {lightType}',
    es: 'Dispositivo antiguo "{name}" migrado como {lightType}',
    pl: 'Stare urz\u0105dzenie "{name}" zmigrowane jako {lightType}',
    uk: '\u0417\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0438\u0439 \u043F\u0440\u0438\u0441\u0442\u0440\u0456\u0439 "{name}" \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E \u044F\u043A {lightType}',
    "zh-cn": '\u65E7\u8BBE\u5907 "{name}" \u5DF2\u8FC1\u79FB\u4E3A {lightType}'
  },
  legacyMigrationItemFailed: {
    en: "Could not migrate legacy device {deviceId}: {error}",
    de: "Migration des alten Ger\xE4ts {deviceId} fehlgeschlagen: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0435\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E {deviceId}: {error}",
    pt: "N\xE3o foi poss\xEDvel migrar o dispositivo antigo {deviceId}: {error}",
    nl: "Migratie van oud apparaat {deviceId} mislukt: {error}",
    fr: "Migration de l'ancien appareil {deviceId} impossible : {error}",
    it: "Impossibile migrare il dispositivo precedente {deviceId}: {error}",
    es: "No se pudo migrar el dispositivo antiguo {deviceId}: {error}",
    pl: "Nie uda\u0142o si\u0119 zmigrowa\u0107 starego urz\u0105dzenia {deviceId}: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u043B\u0438\u0439 \u043F\u0440\u0438\u0441\u0442\u0440\u0456\u0439 {deviceId}: {error}",
    "zh-cn": "\u65E0\u6CD5\u8FC1\u79FB\u65E7\u8BBE\u5907 {deviceId}\uFF1A{error}"
  },
  legacyMigrationDone: {
    en: "Migration complete: {count} device(s) converted. Adapter will restart.",
    de: "Migration abgeschlossen: {count} Ger\xE4t(e) konvertiert. Adapter startet neu.",
    ru: "\u041C\u0438\u0433\u0440\u0430\u0446\u0438\u044F \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0430: \u043F\u0440\u0435\u043E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u043D\u043E {count} \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432(\u0430). \u0410\u0434\u0430\u043F\u0442\u0435\u0440 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0441\u044F.",
    pt: "Migra\xE7\xE3o conclu\xEDda: {count} dispositivo(s) convertido(s). O adaptador ir\xE1 reiniciar.",
    nl: "Migratie voltooid: {count} apparaat/apparaten omgezet. Adapter start opnieuw op.",
    fr: "Migration termin\xE9e : {count} appareil(s) converti(s). L'adaptateur red\xE9marre.",
    it: "Migrazione completata: {count} dispositivo/i convertito/i. L'adattatore si riavvier\xE0.",
    es: "Migraci\xF3n completada: {count} dispositivo(s) convertido(s). El adaptador se reiniciar\xE1.",
    pl: "Migracja zako\u0144czona: skonwertowano {count} urz\u0105dze\u0144. Adapter zostanie zrestartowany.",
    uk: "\u041C\u0456\u0433\u0440\u0430\u0446\u0456\u044E \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u043E: \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E {count} \u043F\u0440\u0438\u0441\u0442\u0440(\u0456\u0439/\u043E\u0457). \u0410\u0434\u0430\u043F\u0442\u0435\u0440 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C\u0441\u044F.",
    "zh-cn": "\u8FC1\u79FB\u5B8C\u6210\uFF1A\u5DF2\u8F6C\u6362 {count} \u4E2A\u8BBE\u5907\u3002\u9002\u914D\u5668\u5C06\u91CD\u542F\u3002"
  },
  clientsFolderMigrated: {
    en: 'Migrated {count} paired client(s) from "user" to "clients"',
    de: '{count} gepaarte(n) Client(s) von "user" nach "clients" migriert',
    ru: '\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E {count} \u0441\u043E\u043F\u0440\u044F\u0436\u0451\u043D\u043D(\u043E\u0433\u043E/\u044B\u0445) \u043A\u043B\u0438\u0435\u043D\u0442(\u0430/\u043E\u0432) \u0438\u0437 "user" \u0432 "clients"',
    pt: 'Migrado(s) {count} cliente(s) emparelhado(s) de "user" para "clients"',
    nl: '{count} gekoppelde client(s) gemigreerd van "user" naar "clients"',
    fr: '{count} client(s) appair\xE9(s) migr\xE9(s) de "user" vers "clients"',
    it: 'Migrato/i {count} client accoppiato/i da "user" a "clients"',
    es: 'Migrado(s) {count} cliente(s) emparejado(s) de "user" a "clients"',
    pl: 'Zmigrowano {count} sparowany(ch) klient(a/\xF3w) z "user" do "clients"',
    uk: '\u041F\u0435\u0440\u0435\u043D\u0435\u0441\u0435\u043D\u043E {count} \u0441\u043F\u0430\u0440\u0435\u043D\u0438\u0445 \u043A\u043B\u0456\u0454\u043D\u0442(\u0430/\u0456\u0432) \u0437 "user" \u0434\u043E "clients"',
    "zh-cn": '\u5DF2\u5C06 {count} \u4E2A\u5DF2\u914D\u5BF9\u5BA2\u6237\u7AEF\u4ECE "user" \u8FC1\u79FB\u5230 "clients"'
  },
  // ──────── SSDP discovery ────────
  ssdpError: {
    en: "SSDP error: {error}",
    de: "SSDP-Fehler: {error}",
    ru: "\u041E\u0448\u0438\u0431\u043A\u0430 SSDP: {error}",
    pt: "Erro SSDP: {error}",
    nl: "SSDP-fout: {error}",
    fr: "Erreur SSDP : {error}",
    it: "Errore SSDP: {error}",
    es: "Error SSDP: {error}",
    pl: "B\u0142\u0105d SSDP: {error}",
    uk: "\u041F\u043E\u043C\u0438\u043B\u043A\u0430 SSDP: {error}",
    "zh-cn": "SSDP \u9519\u8BEF\uFF1A{error}"
  },
  ssdpStartFailed: {
    en: "Failed to start SSDP server: {error}",
    de: "SSDP-Server konnte nicht gestartet werden: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C SSDP-\u0441\u0435\u0440\u0432\u0435\u0440: {error}",
    pt: "Falha ao iniciar o servidor SSDP: {error}",
    nl: "Starten van SSDP-server mislukt: {error}",
    fr: "Impossible de d\xE9marrer le serveur SSDP : {error}",
    it: "Impossibile avviare il server SSDP: {error}",
    es: "No se pudo iniciar el servidor SSDP: {error}",
    pl: "Nie uda\u0142o si\u0119 uruchomi\u0107 serwera SSDP: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u0438 SSDP-\u0441\u0435\u0440\u0432\u0435\u0440: {error}",
    "zh-cn": "\u65E0\u6CD5\u542F\u52A8 SSDP \u670D\u52A1\u5668\uFF1A{error}"
  },
  // ──────── Device binding ────────
  deviceLoadFailed: {
    en: 'Could not load device "{name}": {error}',
    de: 'Ger\xE4t "{name}" konnte nicht geladen werden: {error}',
    ru: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E "{name}": {error}',
    pt: 'N\xE3o foi poss\xEDvel carregar o dispositivo "{name}": {error}',
    nl: 'Apparaat "{name}" kon niet worden geladen: {error}',
    fr: `Impossible de charger l'appareil "{name}" : {error}`,
    it: 'Impossibile caricare il dispositivo "{name}": {error}',
    es: 'No se pudo cargar el dispositivo "{name}": {error}',
    pl: 'Nie uda\u0142o si\u0119 za\u0142adowa\u0107 urz\u0105dzenia "{name}": {error}',
    uk: '\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0437\u0430\u0432\u0430\u043D\u0442\u0430\u0436\u0438\u0442\u0438 \u043F\u0440\u0438\u0441\u0442\u0440\u0456\u0439 "{name}": {error}',
    "zh-cn": '\u65E0\u6CD5\u52A0\u8F7D\u8BBE\u5907 "{name}"\uFF1A{error}'
  },
  stateSetFailed: {
    en: "Failed to set {stateId}: {error}",
    de: "{stateId} konnte nicht gesetzt werden: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C {stateId}: {error}",
    pt: "N\xE3o foi poss\xEDvel definir {stateId}: {error}",
    nl: "Instellen van {stateId} mislukt: {error}",
    fr: "Impossible de d\xE9finir {stateId} : {error}",
    it: "Impossibile impostare {stateId}: {error}",
    es: "No se pudo establecer {stateId}: {error}",
    pl: "Nie uda\u0142o si\u0119 ustawi\u0107 {stateId}: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0432\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0438 {stateId}: {error}",
    "zh-cn": "\u8BBE\u7F6E {stateId} \u5931\u8D25\uFF1A{error}"
  },
  // ──────── User service ────────
  clientObjectFailed: {
    en: "Failed to create client object {username}: {error}",
    de: "Client-Objekt {username} konnte nicht erstellt werden: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043E\u0431\u044A\u0435\u043A\u0442 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 {username}: {error}",
    pt: "Falha ao criar objeto de cliente {username}: {error}",
    nl: "Aanmaken van client-object {username} mislukt: {error}",
    fr: "Impossible de cr\xE9er l'objet client {username} : {error}",
    it: "Impossibile creare l'oggetto client {username}: {error}",
    es: "No se pudo crear el objeto cliente {username}: {error}",
    pl: "Nie uda\u0142o si\u0119 utworzy\u0107 obiektu klienta {username}: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0441\u0442\u0432\u043E\u0440\u0438\u0442\u0438 \u043E\u0431'\u0454\u043A\u0442 \u043A\u043B\u0456\u0454\u043D\u0442\u0430 {username}: {error}",
    "zh-cn": "\u65E0\u6CD5\u521B\u5EFA\u5BA2\u6237\u7AEF\u5BF9\u8C61 {username}\uFF1A{error}"
  },
  clientStateFailed: {
    en: "Failed to set client state {username}: {error}",
    de: "Client-Status {username} konnte nicht gesetzt werden: {error}",
    ru: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u0430 {username}: {error}",
    pt: "Falha ao definir o estado do cliente {username}: {error}",
    nl: "Instellen van client-status {username} mislukt: {error}",
    fr: "Impossible de d\xE9finir l'\xE9tat client {username} : {error}",
    it: "Impossibile impostare lo stato del client {username}: {error}",
    es: "No se pudo establecer el estado del cliente {username}: {error}",
    pl: "Nie uda\u0142o si\u0119 ustawi\u0107 stanu klienta {username}: {error}",
    uk: "\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0432\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0438 \u0441\u0442\u0430\u043D \u043A\u043B\u0456\u0454\u043D\u0442\u0430 {username}: {error}",
    "zh-cn": "\u65E0\u6CD5\u8BBE\u7F6E\u5BA2\u6237\u7AEF\u72B6\u6001 {username}\uFF1A{error}"
  },
  clientsFolderFailed: {
    en: "Failed to create clients folder: {error}",
    de: '"clients"-Ordner konnte nicht erstellt werden: {error}',
    ru: '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C \u043F\u0430\u043F\u043A\u0443 "clients": {error}',
    pt: 'Falha ao criar a pasta "clients": {error}',
    nl: 'Aanmaken van map "clients" mislukt: {error}',
    fr: 'Impossible de cr\xE9er le dossier "clients" : {error}',
    it: 'Impossibile creare la cartella "clients": {error}',
    es: 'No se pudo crear la carpeta "clients": {error}',
    pl: 'Nie uda\u0142o si\u0119 utworzy\u0107 folderu "clients": {error}',
    uk: '\u041D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0441\u0442\u0432\u043E\u0440\u0438\u0442\u0438 \u0442\u0435\u043A\u0443 "clients": {error}',
    "zh-cn": '\u65E0\u6CD5\u521B\u5EFA "clients" \u6587\u4EF6\u5939\uFF1A{error}'
  },
  // ──────── API handler ────────
  groupActionFailed: {
    en: "Group action: failed to set light {lightId}: {error}",
    de: "Gruppen-Aktion: Licht {lightId} konnte nicht gesetzt werden: {error}",
    ru: "\u0413\u0440\u0443\u043F\u043F\u043E\u0432\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435: \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0443\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u0432\u0435\u0442 {lightId}: {error}",
    pt: "A\xE7\xE3o de grupo: falha ao definir a luz {lightId}: {error}",
    nl: "Groepsactie: instellen van licht {lightId} mislukt: {error}",
    fr: "Action de groupe : impossible de d\xE9finir la lampe {lightId} : {error}",
    it: "Azione di gruppo: impossibile impostare la luce {lightId}: {error}",
    es: "Acci\xF3n de grupo: no se pudo establecer la luz {lightId}: {error}",
    pl: "Akcja grupy: nie uda\u0142o si\u0119 ustawi\u0107 \u015Bwiat\u0142a {lightId}: {error}",
    uk: "\u0413\u0440\u0443\u043F\u043E\u0432\u0430 \u0434\u0456\u044F: \u043D\u0435 \u0432\u0434\u0430\u043B\u043E\u0441\u044F \u0432\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0438 \u0441\u0432\u0456\u0442\u043B\u043E {lightId}: {error}",
    "zh-cn": "\u7EC4\u64CD\u4F5C\uFF1A\u65E0\u6CD5\u8BBE\u7F6E\u706F {lightId}\uFF1A{error}"
  },
  unhandledRequest: {
    en: "Unhandled request: {method} {url}",
    de: "Unbehandelte Anfrage: {method} {url}",
    ru: "\u041D\u0435\u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441: {method} {url}",
    pt: "Pedido n\xE3o tratado: {method} {url}",
    nl: "Niet-afgehandelde aanvraag: {method} {url}",
    fr: "Requ\xEAte non g\xE9r\xE9e : {method} {url}",
    it: "Richiesta non gestita: {method} {url}",
    es: "Solicitud no manejada: {method} {url}",
    pl: "Nieobs\u0142u\u017Cone \u017C\u0105danie: {method} {url}",
    uk: "\u041D\u0435\u043E\u043F\u0440\u0430\u0446\u044C\u043E\u0432\u0430\u043D\u0438\u0439 \u0437\u0430\u043F\u0438\u0442: {method} {url}",
    "zh-cn": "\u672A\u5904\u7406\u7684\u8BF7\u6C42\uFF1A{method} {url}"
  }
};
function tLog(lang, key, params) {
  var _a;
  const langKey = SUPPORTED_LANGS.includes(lang) ? lang : "en";
  const bundle = LOG_STRINGS[key];
  const template = (_a = bundle[langKey]) != null ? _a : bundle.en;
  return fmt(template, params);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LOG_STRINGS,
  tLog
});
//# sourceMappingURL=i18n-logs.js.map
