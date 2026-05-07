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
var i18n_states_exports = {};
__export(i18n_states_exports, {
  STATE_NAMES: () => STATE_NAMES,
  tName: () => tName
});
module.exports = __toCommonJS(i18n_states_exports);
const STATE_NAMES = {
  // ──────── Clients folder ────────
  clientsFolder: {
    en: "Paired Clients",
    de: "Verbundene Clients",
    ru: "\u0421\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u043A\u043B\u0438\u0435\u043D\u0442\u044B",
    pt: "Clientes emparelhados",
    nl: "Gekoppelde clients",
    fr: "Clients appari\xE9s",
    it: "Client accoppiati",
    es: "Clientes emparejados",
    pl: "Sparowane klienty",
    uk: "\u0421\u043F\u0430\u0440\u0435\u043D\u0456 \u043A\u043B\u0456\u0454\u043D\u0442\u0438",
    "zh-cn": "\u5DF2\u914D\u5BF9\u5BA2\u6237\u7AEF"
  },
  // ──────── startPairing button ────────
  startPairingName: {
    en: "Start Pairing",
    de: "Pairing starten",
    ru: "\u041D\u0430\u0447\u0430\u0442\u044C \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u0435",
    pt: "Iniciar emparelhamento",
    nl: "Koppelen starten",
    fr: "D\xE9marrer l'appairage",
    it: "Avvia accoppiamento",
    es: "Iniciar emparejamiento",
    pl: "Rozpocznij parowanie",
    uk: "\u041F\u043E\u0447\u0430\u0442\u0438 \u0441\u043F\u0430\u0440\u044E\u0432\u0430\u043D\u043D\u044F",
    "zh-cn": "\u5F00\u59CB\u914D\u5BF9"
  },
  startPairingDesc: {
    en: "Enable pairing mode for 50 seconds",
    de: "Pairing-Modus f\xFCr 50 Sekunden aktivieren",
    ru: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0440\u0435\u0436\u0438\u043C \u0441\u043E\u043F\u0440\u044F\u0436\u0435\u043D\u0438\u044F \u043D\u0430 50 \u0441\u0435\u043A\u0443\u043D\u0434",
    pt: "Ativar modo de emparelhamento por 50 segundos",
    nl: "Koppelmodus 50 seconden activeren",
    fr: "Activer le mode d'appairage pendant 50 secondes",
    it: "Attiva la modalit\xE0 accoppiamento per 50 secondi",
    es: "Activar el modo de emparejamiento durante 50 segundos",
    pl: "W\u0142\u0105cz tryb parowania na 50 sekund",
    uk: "\u0423\u0432\u0456\u043C\u043A\u043D\u0443\u0442\u0438 \u0440\u0435\u0436\u0438\u043C \u0441\u043F\u0430\u0440\u044E\u0432\u0430\u043D\u043D\u044F \u043D\u0430 50 \u0441\u0435\u043A\u0443\u043D\u0434",
    "zh-cn": "\u542F\u7528\u914D\u5BF9\u6A21\u5F0F 50 \u79D2"
  },
  // ──────── disableAuth switch ────────
  disableAuthName: {
    en: "Disable Authentication",
    de: "Authentifizierung deaktivieren",
    ru: "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044E",
    pt: "Desativar autentica\xE7\xE3o",
    nl: "Aanmelding uitschakelen",
    fr: "D\xE9sactiver l'authentification",
    it: "Disattiva autenticazione",
    es: "Desactivar autenticaci\xF3n",
    pl: "Wy\u0142\u0105cz uwierzytelnianie",
    uk: "\u0412\u0438\u043C\u043A\u043D\u0443\u0442\u0438 \u0430\u0432\u0442\u0435\u043D\u0442\u0438\u0444\u0456\u043A\u0430\u0446\u0456\u044E",
    "zh-cn": "\u7981\u7528\u8EAB\u4EFD\u9A8C\u8BC1"
  },
  disableAuthDesc: {
    en: "Disable authentication (allow all requests)",
    de: "Authentifizierung deaktivieren (alle Anfragen erlauben)",
    ru: "\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0430\u0443\u0442\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u044E (\u0440\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u044C \u0432\u0441\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u044B)",
    pt: "Desativar autentica\xE7\xE3o (permitir todos os pedidos)",
    nl: "Aanmelding uitschakelen (alle aanvragen toestaan)",
    fr: "D\xE9sactiver l'authentification (autoriser toutes les requ\xEAtes)",
    it: "Disattiva l'autenticazione (consenti tutte le richieste)",
    es: "Desactivar autenticaci\xF3n (permitir todas las solicitudes)",
    pl: "Wy\u0142\u0105cz uwierzytelnianie (zezwalaj na wszystkie \u017C\u0105dania)",
    uk: "\u0412\u0438\u043C\u043A\u043D\u0443\u0442\u0438 \u0430\u0432\u0442\u0435\u043D\u0442\u0438\u0444\u0456\u043A\u0430\u0446\u0456\u044E (\u0434\u043E\u0437\u0432\u043E\u043B\u0438\u0442\u0438 \u0432\u0441\u0456 \u0437\u0430\u043F\u0438\u0442\u0438)",
    "zh-cn": "\u7981\u7528\u8EAB\u4EFD\u9A8C\u8BC1\uFF08\u5141\u8BB8\u6240\u6709\u8BF7\u6C42\uFF09"
  }
};
function tName(key) {
  return STATE_NAMES[key];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  STATE_NAMES,
  tName
});
//# sourceMappingURL=i18n-states.js.map
