/**
 * Localized log strings — info/warn/error end up in the ioBroker admin log,
 * which is user-facing. Translations cover all 11 ioBroker system languages
 * (en/de/ru/pt/nl/fr/it/es/pl/uk/zh-cn).
 *
 * The active language is read once in `main.onReady` from
 * `system.config.language` and stored on the adapter instance. A language
 * change in admin requires an adapter restart — acceptable, users don't
 * switch languages on the fly.
 *
 * Debug logs stay English (maintainer diagnostics, not user-visible at
 * default loglevel).
 */

const SUPPORTED_LANGS = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

/**
 * Token substitution: `{name}` in the template is replaced with `params.name`.
 * `null` values render as `(none)`, missing tokens are kept as `{key}` so a
 * caller bug surfaces in the log instead of silently emitting an empty string.
 *
 * @param template Localized log string with `{key}` placeholders.
 * @param params   Token values; `null` → `(none)`, `undefined` → token kept.
 */
function fmt(template: string, params?: Record<string, string | number | null | undefined>): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === null) {
      return "(none)";
    }
    if (v === undefined) {
      return `{${key}}`;
    }
    return String(v);
  });
}

/**
 * All user-facing info/warn/error strings. Keys are descriptive identifiers,
 * values are bundles for the 11 supported ioBroker system languages.
 */
export const LOG_STRINGS = {
  // ──────── Adapter lifecycle / crash defense ────────
  onReadyFailed: {
    en: "onReady failed: {error}",
    de: "onReady fehlgeschlagen: {error}",
    ru: "onReady завершился с ошибкой: {error}",
    pt: "onReady falhou: {error}",
    nl: "onReady is mislukt: {error}",
    fr: "onReady a échoué : {error}",
    it: "onReady non riuscito: {error}",
    es: "onReady falló: {error}",
    pl: "onReady nie powiódł się: {error}",
    uk: "onReady завершився з помилкою: {error}",
    "zh-cn": "onReady 失败：{error}",
  },
  unhandledRejection: {
    en: "Unhandled rejection: {error}",
    de: "Unbehandelte Promise-Rejection: {error}",
    ru: "Необработанный rejection: {error}",
    pt: "Rejeição não tratada: {error}",
    nl: "Onafgehandelde rejection: {error}",
    fr: "Rejet non géré : {error}",
    it: "Rejection non gestita: {error}",
    es: "Rechazo no manejado: {error}",
    pl: "Nieobsłużone odrzucenie: {error}",
    uk: "Необроблений rejection: {error}",
    "zh-cn": "未处理的 rejection：{error}",
  },
  uncaughtException: {
    en: "Uncaught exception: {error}",
    de: "Nicht abgefangene Exception: {error}",
    ru: "Необработанное исключение: {error}",
    pt: "Exceção não capturada: {error}",
    nl: "Niet-opgevangen exception: {error}",
    fr: "Exception non capturée : {error}",
    it: "Eccezione non catturata: {error}",
    es: "Excepción no capturada: {error}",
    pl: "Nieprzechwycony wyjątek: {error}",
    uk: "Неперехоплене виключення: {error}",
    "zh-cn": "未捕获的异常：{error}",
  },
  startupFailed: {
    en: "Failed to start Hue Emulator: {error}",
    de: "Hue-Emulator konnte nicht gestartet werden: {error}",
    ru: "Не удалось запустить Hue-эмулятор: {error}",
    pt: "Falha ao iniciar o emulador Hue: {error}",
    nl: "Starten van Hue-emulator mislukt: {error}",
    fr: "Impossible de démarrer l'émulateur Hue : {error}",
    it: "Impossibile avviare l'emulatore Hue: {error}",
    es: "No se pudo iniciar el emulador Hue: {error}",
    pl: "Nie udało się uruchomić emulatora Hue: {error}",
    uk: "Не вдалося запустити Hue-емулятор: {error}",
    "zh-cn": "无法启动 Hue 模拟器：{error}",
  },
  shutdownError: {
    en: "Error during shutdown: {error}",
    de: "Fehler beim Beenden: {error}",
    ru: "Ошибка при завершении: {error}",
    pt: "Erro durante o encerramento: {error}",
    nl: "Fout tijdens afsluiten: {error}",
    fr: "Erreur lors de l'arrêt : {error}",
    it: "Errore durante l'arresto: {error}",
    es: "Error durante el apagado: {error}",
    pl: "Błąd podczas zamykania: {error}",
    uk: "Помилка під час завершення: {error}",
    "zh-cn": "关机时出错：{error}",
  },
  serverStopError: {
    en: "Server stop error: {error}",
    de: "Fehler beim Stoppen des Servers: {error}",
    ru: "Ошибка при остановке сервера: {error}",
    pt: "Erro ao parar o servidor: {error}",
    nl: "Fout bij stoppen van server: {error}",
    fr: "Erreur d'arrêt du serveur : {error}",
    it: "Errore di arresto del server: {error}",
    es: "Error al detener el servidor: {error}",
    pl: "Błąd zatrzymania serwera: {error}",
    uk: "Помилка зупинки сервера: {error}",
    "zh-cn": "服务器停止错误：{error}",
  },

  // ──────── Startup / runtime ────────
  hueEmulatorStarted: {
    en: "Hue Emulator running on {host}:{port}{httpsPart}, {count} device(s)",
    de: "Hue-Emulator läuft auf {host}:{port}{httpsPart}, {count} Gerät(e)",
    ru: "Hue-эмулятор запущен на {host}:{port}{httpsPart}, {count} устройств(а)",
    pt: "Emulador Hue em execução em {host}:{port}{httpsPart}, {count} dispositivo(s)",
    nl: "Hue-emulator actief op {host}:{port}{httpsPart}, {count} apparaat/apparaten",
    fr: "Émulateur Hue en cours sur {host}:{port}{httpsPart}, {count} appareil(s)",
    it: "Emulatore Hue in esecuzione su {host}:{port}{httpsPart}, {count} dispositivo/i",
    es: "Emulador Hue en marcha en {host}:{port}{httpsPart}, {count} dispositivo(s)",
    pl: "Emulator Hue działa na {host}:{port}{httpsPart}, {count} urządzeni(e/a)",
    uk: "Hue-емулятор працює на {host}:{port}{httpsPart}, {count} пристр(ій/ої)",
    "zh-cn": "Hue 模拟器运行于 {host}:{port}{httpsPart}，{count} 个设备",
  },

  // ──────── Auth toggle ────────
  authDisabled: {
    en: "Authentication disabled (all requests allowed)",
    de: "Authentifizierung deaktiviert (alle Anfragen erlaubt)",
    ru: "Аутентификация отключена (все запросы разрешены)",
    pt: "Autenticação desativada (todos os pedidos permitidos)",
    nl: "Aanmelding uitgeschakeld (alle aanvragen toegestaan)",
    fr: "Authentification désactivée (toutes les requêtes autorisées)",
    it: "Autenticazione disattivata (tutte le richieste consentite)",
    es: "Autenticación desactivada (se permiten todas las solicitudes)",
    pl: "Uwierzytelnianie wyłączone (wszystkie żądania dozwolone)",
    uk: "Автентифікацію вимкнено (всі запити дозволені)",
    "zh-cn": "身份验证已禁用（允许所有请求）",
  },
  authEnabled: {
    en: "Authentication enabled",
    de: "Authentifizierung aktiviert",
    ru: "Аутентификация включена",
    pt: "Autenticação ativada",
    nl: "Aanmelding ingeschakeld",
    fr: "Authentification activée",
    it: "Autenticazione attivata",
    es: "Autenticación activada",
    pl: "Uwierzytelnianie włączone",
    uk: "Автентифікацію увімкнено",
    "zh-cn": "身份验证已启用",
  },

  // ──────── Pairing ────────
  pairingEnabled: {
    en: "Pairing mode enabled — waiting for client to connect ({seconds} seconds)",
    de: "Pairing-Modus aktiv — warte auf Verbindung eines Clients ({seconds} Sekunden)",
    ru: "Режим сопряжения включён — ожидание клиента ({seconds} секунд)",
    pt: "Modo de emparelhamento ativo — aguardando ligação do cliente ({seconds} segundos)",
    nl: "Koppelmodus actief — wachten op clientverbinding ({seconds} seconden)",
    fr: "Mode d'appairage activé — en attente d'un client ({seconds} secondes)",
    it: "Modalità accoppiamento attiva — attesa di un client ({seconds} secondi)",
    es: "Modo de emparejamiento activo — esperando cliente ({seconds} segundos)",
    pl: "Tryb parowania aktywny — oczekiwanie na klienta ({seconds} sekund)",
    uk: "Режим спарювання активний — очікування клієнта ({seconds} секунд)",
    "zh-cn": "配对模式已启用 — 等待客户端连接（{seconds} 秒）",
  },
  pairingDisabled: {
    en: "Pairing mode disabled",
    de: "Pairing-Modus deaktiviert",
    ru: "Режим сопряжения отключён",
    pt: "Modo de emparelhamento desativado",
    nl: "Koppelmodus uitgeschakeld",
    fr: "Mode d'appairage désactivé",
    it: "Modalità accoppiamento disattivata",
    es: "Modo de emparejamiento desactivado",
    pl: "Tryb parowania wyłączony",
    uk: "Режим спарювання вимкнено",
    "zh-cn": "配对模式已禁用",
  },
  pairingTimeout: {
    en: "Pairing mode automatically disabled after {seconds} seconds timeout",
    de: "Pairing-Modus nach {seconds} Sekunden Timeout automatisch deaktiviert",
    ru: "Режим сопряжения автоматически отключён по таймауту ({seconds} с)",
    pt: "Modo de emparelhamento desativado automaticamente após {seconds} segundos",
    nl: "Koppelmodus automatisch uitgeschakeld na {seconds} seconden time-out",
    fr: "Mode d'appairage désactivé automatiquement après {seconds} secondes de timeout",
    it: "Modalità accoppiamento disattivata automaticamente dopo {seconds} secondi di timeout",
    es: "Modo de emparejamiento desactivado automáticamente tras {seconds} segundos",
    pl: "Tryb parowania automatycznie wyłączony po upływie {seconds} sekund",
    uk: "Режим спарювання автоматично вимкнено після {seconds} с тайм-ауту",
    "zh-cn": "配对模式在 {seconds} 秒超时后自动禁用",
  },
  clientPaired: {
    en: 'Paired client "{devicetype}" as user {username}',
    de: 'Client "{devicetype}" gepaart als Benutzer {username}',
    ru: 'Клиент "{devicetype}" сопряжён как пользователь {username}',
    pt: 'Cliente "{devicetype}" emparelhado como utilizador {username}',
    nl: 'Client "{devicetype}" gekoppeld als gebruiker {username}',
    fr: 'Client "{devicetype}" appairé en tant qu\'utilisateur {username}',
    it: 'Client "{devicetype}" accoppiato come utente {username}',
    es: 'Cliente "{devicetype}" emparejado como usuario {username}',
    pl: 'Klient "{devicetype}" sparowany jako użytkownik {username}',
    uk: 'Клієнта "{devicetype}" спарено як користувача {username}',
    "zh-cn": '已配对客户端 "{devicetype}"，用户名 {username}',
  },

  // ──────── Migration ────────
  legacyMigrationStart: {
    en: "Found {count} legacy device(s) — migrating to new configuration",
    de: "{count} alte(s) Gerät(e) gefunden — Migration zur neuen Konfiguration läuft",
    ru: "Найдено {count} устаревш(ее/их) устройств(о/а) — миграция на новую конфигурацию",
    pt: "Encontrado(s) {count} dispositivo(s) antigo(s) — migrando para nova configuração",
    nl: "{count} oud(e) apparaat/apparaten gevonden — migratie naar nieuwe configuratie",
    fr: "{count} appareil(s) ancien(s) trouvé(s) — migration vers la nouvelle configuration",
    it: "Trovato/i {count} dispositivo/i precedente/i — migrazione alla nuova configurazione",
    es: "Encontrado(s) {count} dispositivo(s) antiguo(s) — migrando a la nueva configuración",
    pl: "Znaleziono {count} stary(ch) urządzeń — migracja do nowej konfiguracji",
    uk: "Знайдено {count} застарілих пристр(ій/ої) — міграція до нової конфігурації",
    "zh-cn": "发现 {count} 个旧设备 — 正迁移到新配置",
  },
  legacyMigrationItem: {
    en: 'Migrated legacy device "{name}" as {lightType}',
    de: 'Altes Gerät "{name}" als {lightType} migriert',
    ru: 'Устаревшее устройство "{name}" перенесено как {lightType}',
    pt: 'Dispositivo antigo "{name}" migrado como {lightType}',
    nl: 'Oud apparaat "{name}" gemigreerd als {lightType}',
    fr: 'Ancien appareil "{name}" migré en tant que {lightType}',
    it: 'Dispositivo precedente "{name}" migrato come {lightType}',
    es: 'Dispositivo antiguo "{name}" migrado como {lightType}',
    pl: 'Stare urządzenie "{name}" zmigrowane jako {lightType}',
    uk: 'Застарілий пристрій "{name}" перенесено як {lightType}',
    "zh-cn": '旧设备 "{name}" 已迁移为 {lightType}',
  },
  legacyMigrationItemFailed: {
    en: "Could not migrate legacy device {deviceId}: {error}",
    de: "Migration des alten Geräts {deviceId} fehlgeschlagen: {error}",
    ru: "Не удалось перенести устаревшее устройство {deviceId}: {error}",
    pt: "Não foi possível migrar o dispositivo antigo {deviceId}: {error}",
    nl: "Migratie van oud apparaat {deviceId} mislukt: {error}",
    fr: "Migration de l'ancien appareil {deviceId} impossible : {error}",
    it: "Impossibile migrare il dispositivo precedente {deviceId}: {error}",
    es: "No se pudo migrar el dispositivo antiguo {deviceId}: {error}",
    pl: "Nie udało się zmigrować starego urządzenia {deviceId}: {error}",
    uk: "Не вдалося перенести застарілий пристрій {deviceId}: {error}",
    "zh-cn": "无法迁移旧设备 {deviceId}：{error}",
  },
  legacyMigrationDone: {
    en: "Migration complete: {count} device(s) converted. Adapter will restart.",
    de: "Migration abgeschlossen: {count} Gerät(e) konvertiert. Adapter startet neu.",
    ru: "Миграция завершена: преобразовано {count} устройств(а). Адаптер перезапустится.",
    pt: "Migração concluída: {count} dispositivo(s) convertido(s). O adaptador irá reiniciar.",
    nl: "Migratie voltooid: {count} apparaat/apparaten omgezet. Adapter start opnieuw op.",
    fr: "Migration terminée : {count} appareil(s) converti(s). L'adaptateur redémarre.",
    it: "Migrazione completata: {count} dispositivo/i convertito/i. L'adattatore si riavvierà.",
    es: "Migración completada: {count} dispositivo(s) convertido(s). El adaptador se reiniciará.",
    pl: "Migracja zakończona: skonwertowano {count} urządzeń. Adapter zostanie zrestartowany.",
    uk: "Міграцію завершено: перенесено {count} пристр(ій/ої). Адаптер перезапуститься.",
    "zh-cn": "迁移完成：已转换 {count} 个设备。适配器将重启。",
  },
  clientsFolderMigrated: {
    en: 'Migrated {count} paired client(s) from "user" to "clients"',
    de: '{count} gepaarte(n) Client(s) von "user" nach "clients" migriert',
    ru: 'Перенесено {count} сопряжённ(ого/ых) клиент(а/ов) из "user" в "clients"',
    pt: 'Migrado(s) {count} cliente(s) emparelhado(s) de "user" para "clients"',
    nl: '{count} gekoppelde client(s) gemigreerd van "user" naar "clients"',
    fr: '{count} client(s) appairé(s) migré(s) de "user" vers "clients"',
    it: 'Migrato/i {count} client accoppiato/i da "user" a "clients"',
    es: 'Migrado(s) {count} cliente(s) emparejado(s) de "user" a "clients"',
    pl: 'Zmigrowano {count} sparowany(ch) klient(a/ów) z "user" do "clients"',
    uk: 'Перенесено {count} спарених клієнт(а/ів) з "user" до "clients"',
    "zh-cn": '已将 {count} 个已配对客户端从 "user" 迁移到 "clients"',
  },

  // ──────── SSDP discovery ────────
  ssdpError: {
    en: "SSDP error: {error}",
    de: "SSDP-Fehler: {error}",
    ru: "Ошибка SSDP: {error}",
    pt: "Erro SSDP: {error}",
    nl: "SSDP-fout: {error}",
    fr: "Erreur SSDP : {error}",
    it: "Errore SSDP: {error}",
    es: "Error SSDP: {error}",
    pl: "Błąd SSDP: {error}",
    uk: "Помилка SSDP: {error}",
    "zh-cn": "SSDP 错误：{error}",
  },
  ssdpStartFailed: {
    en: "Failed to start SSDP server: {error}",
    de: "SSDP-Server konnte nicht gestartet werden: {error}",
    ru: "Не удалось запустить SSDP-сервер: {error}",
    pt: "Falha ao iniciar o servidor SSDP: {error}",
    nl: "Starten van SSDP-server mislukt: {error}",
    fr: "Impossible de démarrer le serveur SSDP : {error}",
    it: "Impossibile avviare il server SSDP: {error}",
    es: "No se pudo iniciar el servidor SSDP: {error}",
    pl: "Nie udało się uruchomić serwera SSDP: {error}",
    uk: "Не вдалося запустити SSDP-сервер: {error}",
    "zh-cn": "无法启动 SSDP 服务器：{error}",
  },

  // ──────── Device binding ────────
  deviceLoadFailed: {
    en: 'Could not load device "{name}": {error}',
    de: 'Gerät "{name}" konnte nicht geladen werden: {error}',
    ru: 'Не удалось загрузить устройство "{name}": {error}',
    pt: 'Não foi possível carregar o dispositivo "{name}": {error}',
    nl: 'Apparaat "{name}" kon niet worden geladen: {error}',
    fr: 'Impossible de charger l\'appareil "{name}" : {error}',
    it: 'Impossibile caricare il dispositivo "{name}": {error}',
    es: 'No se pudo cargar el dispositivo "{name}": {error}',
    pl: 'Nie udało się załadować urządzenia "{name}": {error}',
    uk: 'Не вдалося завантажити пристрій "{name}": {error}',
    "zh-cn": '无法加载设备 "{name}"：{error}',
  },
  stateSetFailed: {
    en: "Failed to set {stateId}: {error}",
    de: "{stateId} konnte nicht gesetzt werden: {error}",
    ru: "Не удалось установить {stateId}: {error}",
    pt: "Não foi possível definir {stateId}: {error}",
    nl: "Instellen van {stateId} mislukt: {error}",
    fr: "Impossible de définir {stateId} : {error}",
    it: "Impossibile impostare {stateId}: {error}",
    es: "No se pudo establecer {stateId}: {error}",
    pl: "Nie udało się ustawić {stateId}: {error}",
    uk: "Не вдалося встановити {stateId}: {error}",
    "zh-cn": "设置 {stateId} 失败：{error}",
  },

  // ──────── User service ────────
  clientObjectFailed: {
    en: "Failed to create client object {username}: {error}",
    de: "Client-Objekt {username} konnte nicht erstellt werden: {error}",
    ru: "Не удалось создать объект клиента {username}: {error}",
    pt: "Falha ao criar objeto de cliente {username}: {error}",
    nl: "Aanmaken van client-object {username} mislukt: {error}",
    fr: "Impossible de créer l'objet client {username} : {error}",
    it: "Impossibile creare l'oggetto client {username}: {error}",
    es: "No se pudo crear el objeto cliente {username}: {error}",
    pl: "Nie udało się utworzyć obiektu klienta {username}: {error}",
    uk: "Не вдалося створити об'єкт клієнта {username}: {error}",
    "zh-cn": "无法创建客户端对象 {username}：{error}",
  },
  clientStateFailed: {
    en: "Failed to set client state {username}: {error}",
    de: "Client-Status {username} konnte nicht gesetzt werden: {error}",
    ru: "Не удалось установить состояние клиента {username}: {error}",
    pt: "Falha ao definir o estado do cliente {username}: {error}",
    nl: "Instellen van client-status {username} mislukt: {error}",
    fr: "Impossible de définir l'état client {username} : {error}",
    it: "Impossibile impostare lo stato del client {username}: {error}",
    es: "No se pudo establecer el estado del cliente {username}: {error}",
    pl: "Nie udało się ustawić stanu klienta {username}: {error}",
    uk: "Не вдалося встановити стан клієнта {username}: {error}",
    "zh-cn": "无法设置客户端状态 {username}：{error}",
  },
  clientsFolderFailed: {
    en: "Failed to create clients folder: {error}",
    de: '"clients"-Ordner konnte nicht erstellt werden: {error}',
    ru: 'Не удалось создать папку "clients": {error}',
    pt: 'Falha ao criar a pasta "clients": {error}',
    nl: 'Aanmaken van map "clients" mislukt: {error}',
    fr: 'Impossible de créer le dossier "clients" : {error}',
    it: 'Impossibile creare la cartella "clients": {error}',
    es: 'No se pudo crear la carpeta "clients": {error}',
    pl: 'Nie udało się utworzyć folderu "clients": {error}',
    uk: 'Не вдалося створити теку "clients": {error}',
    "zh-cn": '无法创建 "clients" 文件夹：{error}',
  },

  // ──────── API handler ────────
  groupActionFailed: {
    en: "Group action: failed to set light {lightId}: {error}",
    de: "Gruppen-Aktion: Licht {lightId} konnte nicht gesetzt werden: {error}",
    ru: "Групповое действие: не удалось установить свет {lightId}: {error}",
    pt: "Ação de grupo: falha ao definir a luz {lightId}: {error}",
    nl: "Groepsactie: instellen van licht {lightId} mislukt: {error}",
    fr: "Action de groupe : impossible de définir la lampe {lightId} : {error}",
    it: "Azione di gruppo: impossibile impostare la luce {lightId}: {error}",
    es: "Acción de grupo: no se pudo establecer la luz {lightId}: {error}",
    pl: "Akcja grupy: nie udało się ustawić światła {lightId}: {error}",
    uk: "Групова дія: не вдалося встановити світло {lightId}: {error}",
    "zh-cn": "组操作：无法设置灯 {lightId}：{error}",
  },
  unhandledRequest: {
    en: "Unhandled request: {method} {url}",
    de: "Unbehandelte Anfrage: {method} {url}",
    ru: "Необработанный запрос: {method} {url}",
    pt: "Pedido não tratado: {method} {url}",
    nl: "Niet-afgehandelde aanvraag: {method} {url}",
    fr: "Requête non gérée : {method} {url}",
    it: "Richiesta non gestita: {method} {url}",
    es: "Solicitud no manejada: {method} {url}",
    pl: "Nieobsłużone żądanie: {method} {url}",
    uk: "Неопрацьований запит: {method} {url}",
    "zh-cn": "未处理的请求：{method} {url}",
  },
} as const;

/**
 * Look up a log string in the requested language with EN fallback.
 *
 * @param lang   ioBroker system language (`'en'`, `'de'`, …) — any string
 *               accepted, falls back to `en` for unknown values.
 * @param key    Translation key from {@link LOG_STRINGS}.
 * @param params Token values for `{name}` placeholders.
 */
export function tLog(
  lang: string,
  key: keyof typeof LOG_STRINGS,
  params?: Record<string, string | number | null | undefined>,
): string {
  const langKey = (SUPPORTED_LANGS as readonly string[]).includes(lang) ? (lang as Lang) : "en";
  const bundle = LOG_STRINGS[key];
  const template = bundle[langKey] ?? bundle.en;
  return fmt(template, params);
}
