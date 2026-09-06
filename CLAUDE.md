# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (MERGED, im Latest-Repo)
- **Herkunft:** Fork von Christopher Holomeks GitHub-Projekt (@holomekc, aktiv 2020-03 bis 2021-05). **Keine Übergabe** — nie auf npm, nie bei ioBroker eingereicht; krobi hat ab 2026-03 übernommen und das npm-Paket am 2026-03-16 erstveröffentlicht. Copyright/Credits-Zuordnung folgt der flottenweiten 4-Ebenen-Regel (Memory `reference_copyright_credits_rewrite`)
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-forge`, `uuid`, `@iobroker/dm-utils` (Geräte-Manager-Backend), `@iobroker/type-detector` (Licht-Scan). `node-ssdp` wurde v1.13.0 durch einen Eigenbau ersetzt (unmaintained seit 2020, unfixbarer `ip`-Advisory, verschluckte Bind-Fehler)
- **Test-Setup:** vitest (globals mode, pool: forks) — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/. **Die Test-Suiten laufen unter dem Lint** (seit 2026-09-02, Flotte): Attrappen ohne `await` als `Promise.resolve()/reject()`, Mock-Fabriken mit Rückgabetyp, `require-await` bleibt an
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards; refreshInstanceObjects — v1.15.0; setConnected → info.connection/info.error — v1.17.0)
src/discovery/ssdp-server.ts      → UPnP/SSDP-Eigenbau auf node:dgram (fakeroku-Muster; Datagramme byte-identisch zur node-ssdp-4.0.1-Wire-Capture 2026-08-24; announce() vom Adapter-Interval getrieben, byebye bei stop)
src/discovery/ssdp-messages.ts    → reine SSDP-Datagramm-Builder + M-SEARCH-Parser (unit-getestet gegen die Capture)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + resetAutoAddBudget + whitelistProvider wireup + isKnownUser (reine Prüfung für /config) + Längengrenzen (Benutzername 64, Gerätetyp 100; v1.14.0)
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → Zustands-Cache + Licht-Aufbau + Schreibpfad (KEINE Umrechnung mehr, die liegt in lib/hue-scales.ts). ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, parseLightIndex, hex uniqueid, xy round-trip, detectColorMode from mapped states; Cache nur für gemappte IDs, ungültige Zahlen beim Schreiben übersprungen — v1.14.0; brightnessImpliesOn/switchViaBrightness + resolveIncrements/applyIncrement — v1.15.0)
src/hue-api/user-service.ts       → Auth/Pairing (auto-add-cap 64/window, in-memory client-id cache, listCachedClientIds for whitelist, Stunden-Obergrenze 100 Neuanlagen über alle Pfade — v1.14.0; enforceCreateCeiling PRÜFT nur, countCreatedClient bucht nach echter Anlage — v1.15.0)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice; new HueEmuDeviceManagement(this) im main.ts-Konstruktor). guardAction umschließt JEDEN registrierten Handler, loadDevices fängt selbst — ein Handler antwortet immer (Entscheidung 19)
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping; adapter-agnostisch, gegen echten type-detector getestet). v1.15.0: Skalen-Ableitung (deriveLevelScale/deriveHueScale/deriveCtScale aus common.min/max/unit), Schreibbarkeitsprüfung am echten Objekt (stateFactsOf), TEMPERATURE auch bei hue/cie, MapOutcome mit UnmappedReason
src/lib/migrations.ts             → + runDeviceScaleBackfill (v1.15.0): füllt LEERE Skalen bestehender native.devices nach, einmalig in onReady, Neustart-Kurzschluss wie die Legacy-Migration
src/lib/hue-scales.ts             → v1.17.0 ALLES über Hue-Werteskalen an EINER Stelle: Bereiche, beide Umrechnungsrichtungen, Ableitung aus common.min/max/unit (aus device-scan gezogen), Inkremente. Rein — Logger als Parameter
src/lib/tls-material.ts           → v1.17.0 selbstsigniertes TLS (aus main.ts gezogen, Form wie migrations.ts: reiner Helfer + getippte Abhängigkeits-Schnittstelle)
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parseLightIndex + parsePort (shared boundary helpers)
src/lib/i18n.ts                   → tName + t + tRaw (Rohtext in alle 11 Sprachen, v1.15.1): type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json)
src/server/hue-server.ts          → Fastify HTTP/HTTPS (trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints (+ GET /api/config ohne Benutzername, v1.14.0)
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors (+ REASON_UNKNOWN + ConfigurationError, v1.17.0), hue-api, light, utils (sanitizeId + errText + oneLine über den ganzen C0-Bereich)
docs/en/README.md, docs/de/README.md → Nutzerdoku fürs ioBroker-Doku-Portal (common.docs; ohne das Feld zeigt das Portal nur die README)
../scripts/sync-iopackage-from-i18n.py → hält io-package.json:instanceObjects synchron mit admin/i18n (zentral, source: admin-i18n)
```

## Design-Entscheidungen

1. **Fastify** statt Express — schneller, besseres TypeScript-Support
2. **SSDP Port 1900 hardcoded** — UPnP-Standard, alle Clients scannen fix diesen Port
3. **host = bind + advertise** — IP wird für SSDP-Location UND Server-Bind verwendet → kein 0.0.0.0
4. **Port 8080 Default** — Harmony funktioniert mit 8080. Alexa neuere FW braucht Port 80 (User-Sache, README dokumentiert).
5. **onoff → LWB007/Dimmable** — Harmony kennt "On/Off light" nicht, fällt sonst auf Farb-Controls zurück
6. **capabilities-Feld weggelassen** — ha-bridge-kompatibel
7. **Pairing 50s Timeout** — Auto-Add aller Usernames während Fenster (Alexa/Harmony Kompatibilität)
8. **TLS self-signed** — 2048-bit RSA via node-forge, 10 Jahre Gültigkeit
9. **"clients" statt "user"** — Paired endpoints (Alexa, Harmony, Google Home) sind Clients, nicht User. "devices" = veröffentlichte Hue-Lichter
10. **`GET /api/config` öffentlich, `/api/<user>/config` ohne Auto-Aufnahme** (v1.14.0) — Discovery-Apps pollen `/api/nouser/config` (oder `/api/config`) während des Kopplungsfensters; die Auto-Aufnahme auf dieser Route hätte den bekannten Namen zum gültigen Schlüssel gemacht. Auto-Aufnahme bleibt nur auf Gesamtzustand/Lichter (Echo/Harmony brauchen sie dort). `isKnownUser` = reine Prüfung.
11. **Stunden-Obergrenze 100 Neuanlagen** über alle Pfade (`CLIENT_CREATE_CEILING_PER_HOUR`, festes Fenster ab erster Anlage, Zähler beim Fensterwechsel genullt, Warnung 1×/Fenster; darüber Antwort 101 “link button not pressed”) — `disableAuth` nimmt POST /api das Knopf-Gate, ohne Obergrenze wächst die Objekt-DB unbegrenzt (Klasse hassemu 1.40.0). Legitime Nutzung koppelt eine Handvoll Clients pro Installation, nie 100 pro Stunde.
12. **Längengrenzen für Client-Eingaben** (v1.14.0) — Benutzername > 64 Zeichen wird ignoriert (UUID wie bei der echten Bridge, die immer selbst vergibt), Gerätetyp auf 100 Zeichen gekürzt; beides landete sonst bis 64 KiB als Objekt-ID/Anzeigename in der DB. Auto-Aufnahme überlanger Namen aus der URL: nein.
13. **Ungültige Zahlen beim Schreiben werden übersprungen, nicht auf Vorgabe gesetzt** (v1.14.0) — `bri:"abc"` schrieb 100 %, `hue:{}` schrieb 0 (Rot); jetzt wie xy seit 1.4.3: kein Schreibvorgang, Erfolg trotzdem quittiert. Lesepfad unverändert (ein Fremdzustand mit Müll rendert weiter mit Vorgaben).
14. **Skalen werden abgeleitet, aber NUR mit Beleg am Zielobjekt** (v1.15.0) — Belegquellen sind ausschließlich `common.min`/`common.max` und `common.unit`; **die Rolle zählt NIE**. Grund, am Live-System gemessen (2026-09-03): der zigbee-Adapter liefert `level.color.temperature` in **Mired** ohne Einheit und ohne Grenzen, während das Muster des type-detectors `°K` behauptet — eine Ableitung aus der Rolle hätte funktionierende Bindungen von richtig auf falsch gedreht. Ohne Beleg bleibt das Feld leer (= Vorgabe wie bisher). Der Nachzug (`runDeviceScaleBackfill`) füllt nur LEERE Felder und überschreibt eine gesetzte Skala nie.
15. **Ein Licht ohne Schalt-Datenpunkt wird über die Helligkeit gefahren** (v1.15.0) — Quellwert 0 = aus, > 0 = an; `on:false` schreibt 0, `on:true` schreibt volle Helligkeit (eine Quelle auf 0 kennt ihren früheren Wert nicht mehr). Bringt dieselbe Anfrage ein eigenes `bri` mit, gewinnt dieses beim Einschalten (sonst sichtbarer Helligkeitssprung) — und **beim Ausschalten gewinnt das Aus** (sonst schaltet die Helligkeit derselben Anfrage sofort wieder ein). Anlass: der HomeMatic HmIP-BDT legt seinen Dimmer-Kanal als `DIMMER_VIRTUAL_RECEIVER` mit `LEVEL` und ohne jeden booleschen Datenpunkt an.
16. **Relative Attribute (`bri_inc` & Co.) werden ausgeführt** (v1.15.0) — Semantik gegen die offizielle Parameterbeschreibung und die Referenz-Bridge diyHue (`HueObjects/__init__.py:incProcess`, ebd0eaf) belegt: `_inc` wird ignoriert, wenn das absolute Feld in derselben Anfrage steht; Ergebnis geklemmt außer `hue`, das **umläuft**; Antwort trägt die **absolute** Adresse. Bewusste Abweichungen: jedes `_inc` einer Anfrage wird bedient (diyHue nur das erste), und `hue` läuft modulo 65536 um (0..65535 sind 65536 Werte). Ist das Grund-Attribut nicht abgebildet oder die Nutzlast unbrauchbar, gilt wie beim absoluten Feld: quittiert, nichts geschrieben.
17. **Die eigenen Objekte werden bei JEDEM Start per `extendObject` erneuert** (v1.15.0) — js-controller legt `instanceObjects` nur an, wo sie FEHLEN; eine geänderte `common.name`/`desc` erreichte damit ausschließlich Neuinstallationen, während Manifest und Gate grün aussahen ([[reference_iobroker_bestehende_objekte_erreichen]]). `refreshInstanceObjects()` schreibt `startPairing`/`disableAuth`/`clients` unbedingt. **Das löst die v1.4.0-Namens-Migration ab**, die nur anfasste, was noch exakt die alte englische Vorgabe trug — jede spätere Textänderung war für bestehende Anlagen unsichtbar. Bewusste Folge: eine Umbenennung durch den Nutzer wird überschrieben; der Adapter verantwortet seinen Datenpunkt-Bestand allein ([[feedback_adapter_verantwortet_datenpunkte]]).
18. **JEDER Datenpunkt trägt Namen UND Erklärung in 11 Sprachen — auch die zur Laufzeit erzeugten** (v1.15.1) — `tRaw()` in `lib/i18n.ts` legt den vom Gerät gelieferten Gerätetyp unter allen elf Sprachen ab. Es gibt nichts zu übersetzen (der Client schickt EINEN String), aber `common.name` ist bei JEDEM Objekttyp ein Übersetzungsobjekt, nie ein fester String (Core-Team, nut2 #15). Der Client-Datenpunkt und der `clients`-Ordner tragen zusätzlich eine `desc` (`clientDesc`/`clientsFolderDesc`; das Ordner-Feld kommt über `sync-iopackage-from-i18n.py` ins Manifest). `refreshClientNames()` zieht bestehende Kopplungen einmalig nach — Namen UND Erklärung, und lässt ein bereits vollständiges Objekt in Ruhe. **Der Legacy-Pfad `user.*` → `clients.*` hebt seit v1.15.2 selbst** (er läuft SPÄT in `onReady`, der Nachzug früh — sonst trüge ein migriertes Objekt seinen alten Text bis zum nächsten Start); ein dort schon übersetzter Name bleibt unangetastet — Client-Objekte entstehen per `setObjectNotExists` und werden sonst nie wieder angefasst. **Herkunft des Fundes: die Prüfung des LAUFENDEN Baums nach dem Deploy** (`check-live-tree.py`), nicht ein statisches Gate — Quelltext, Lint, Typprüfung und Rollen-Gate waren alle grün, während im Baum zwei Clients einen festen String trugen.

19. **Ein Geräte-Manager-Handler antwortet IMMER** (In-depth-Audit 2026-09-03) — `guardAction` umschließt jeden registrierten Einsprung (add/search/edit/delete), `loadDevices` hat einen eigenen Fang. **Warum das nötig ist, an der gebundelten dm-utils 3.2.0 nachgelesen:** das Framework ruft die Handler aus `handleMessage`, dessen einzige Absicherung `void this.handleMessage(obj).catch(this.log.error)` ist — eine Ablehnung **stürzt den Adapter also nicht ab**, bricht `handleMessage` aber an der Wurfstelle ab. Übersprungen werden damit `context.sendFinalResult(...)` (die Antwort, die die Aktion im Admin schließt) **und** `messageContexts.delete(msg._id)`; dm-utils löscht diesen Eintrag nur auf dem normalen Weg und hat **keine eigene Zeitgrenze**. Der Nutzer bliebe mit einer Logzeile zurück. Im Fehlerfall gibt es jetzt: Protokolleintrag (`warn`), Meldung an den Nutzer (`dmActionFailed`, 11 Sprachen) und dieselbe Auffrisch-Anweisung wie auf dem Erfolgsweg. Scheitert auch die Meldung, fängt eine innere Absicherung — der Wächter selbst wirft nie. `loadDevices` läuft über einen ANDEREN Weg (`dm:loadDevices` mit `DeviceLoadContext`, ohne `sendFinalResult` und ohne `showMessage`): dort bleibt die Liste bei unlesbarer Konfiguration leer statt hängen, mit Warnung. `searchDevices` folgte der Regel schon selbst und war die Vorlage.

20. **Die Werteskala wird beim START aufgelöst, nicht in der Konfiguration** (v1.17.0) — `DeviceBindingService.initialize()` fragt für jedes Feld, das keine Entscheidung trägt (`undefined`, `""` oder das alte `"auto"`), die Fakten des gebundenen Objekts ab und setzt die Skala **im Speicher**. Belegregeln unverändert Entscheidung 14. **Warum:** bis v1.16.0 hieß `auto` beim LESEN „rate aus dem Wert" und beim SCHREIBEN „schreib die rohe Hue-Zahl" — ein Client, der halbe Helligkeit setzte, legte 127 in einen 0..100-%-Datenpunkt (gemessen, Audit 2026-09-06 F1). Der Lesepfad verdeckte es, weil sein dritter Zweig 127 wieder als 127 liest. Verschärfend: das Geräte-Manager-Formular hatte `auto` (bzw. `raw`) **vorausgewählt**, und ein gespeicherter Wert galt dem Nachzug als Nutzerentscheidung — ein von Hand angelegtes Licht war damit dauerhaft ausgeschlossen. Jetzt: keine Vorauswahl im Formular (leer = ableiten), `cleanDevice` wirft ein gespeichertes `auto` weg, `buildDeviceScalePatch` behandelt es als unentschieden. Bleibt gar kein Beleg, ist die Heuristik **in beiden Richtungen** dieselbe: der letzte von 0 verschiedene Quellwert sagt, in welcher Skala zurückgeschrieben wird.
21. **Eine Kopplung, die nicht in der Datenbank landet, ist keine Kopplung** (v1.17.0) — `addUser` wirft, wenn das Objekt nicht geschrieben werden konnte; `ApiHandler.createUser` macht daraus Hue-Fehler 101, worauf jeder Client es erneut versucht. Vorher wurde Erfolg gemeldet und der Schlüssel in den Speicher gelegt: der Client lief bis zum nächsten Adapter-Start und verlor dann ohne erkennbaren Grund den Zugang (Audit 2026-09-06 F2). Ebenso bucht das Fenster-Kontingent (64) jetzt **nach** der Anlage, wie die Stunden-Obergrenze seit v1.15.0 (F12).
22. **Angemeldet wird gegen den ECHTEN Schlüssel, nicht gegen die bereinigte Objekt-ID** (v1.17.0) — der Speicher hält `native.username`, nicht die ID. Vorher machte `sanitizeId` jede Stelle eines Schlüssels, die kein `[A-Za-z0-9-_]` ist, zum Platzhalter: wer `living.room` koppelte, kam auch mit `living_room` und `living+room` hinein (gemessen, F3). Ein zweiter Schlüssel, der auf eine belegte ID fiele, wird abgelehnt statt still das fremde Objekt zu übernehmen. Objekt-IDs bleiben bereinigt — sie müssen es sein.
23. **Der Adapter sagt im Objektbaum, ob er bedient** (v1.17.0) — `info.connection` (`indicator.connected`) und `info.error` . Der Grund-Text folgt der Flotten-Linie (`REASON_UNKNOWN`, EINE Konstante in `types/errors.ts`): `Unknown` solange nichts zu melden ist, leer solange alles läuft, sonst die echte Ursache — nie „Adapter gestoppt". **Und nie hueemus EIGENE Formulierung:** ein Startfehler, den der Adapter selbst diagnostiziert (`ConfigurationError` — kein Port, keine erreichbare Adresse, Port-Kollision), trägt `Unknown` im Datenpunkt und seinen Klartext im Log; nur ein Text von AUSSEN (node: `listen EADDRINUSE …`) erreicht den Datenpunkt unverändert. Die Herkunft steht dafür im TYP, nicht im Wortlaut — das npm-Gate `error-text-selfstate` sucht `adapter|instance` + `stop|off|down` in derselben Zeile und ist blind für einen Text, der über `errText(error)` aus einer anderen Datei kommt: es war grün, während „Port not specified" und „… — set the Host/IP in admin config …" im Datenpunkt landeten. Ein gescheiterter Start hinterließ vorher **eine** Logzeile bei grüner Instanz (F4). ⚠️ Beide IDs standen bis v1.16.0 in `OBSOLETE_STATE_IDS` (Entfernung 1.1.3) — sie **mussten** dort raus: die Aufräumung läuft in `onReady` NACH dem Anlegen, sonst würden sie bei jedem Start angelegt und sofort gelöscht.
24. **Der `clients`-Ordner ist ein `folder`, kein `meta`** (v1.17.0) — repochecker zählt `meta` nicht zu den Hierarchie-Typen (`HIERARCHY_TYPES = device/channel/state/folder`, `lib/config_StateRoles.js`), ein Client-State darunter ist also **E2001**. Gefunden hat es erst das neue Objekt-Inventar; sechs Vorgänger-Audits sahen es nicht, weil kein Gate den fertigen Baum las. Der Retrofit **darf ihn nicht mit `null` im `extendObject`-Patch entfernen** — dem flottenüblichen Weg, ein `common`-Feld zu löschen: js-controller prüft den EINGEHENDEN Patch, bevor die Semantik "null heißt löschen" greift, sieht `typeof null === "object"` und schreibt `Object clients is invalid: obj.common.type has an invalid type! … This will throw an error up from js-controller version 7.0.0` — bei JEDEM Start JEDER Anlage, Neuinstallationen eingeschlossen (an js-controller 7.2.3 gemessen: 3 Warnungen je Lauf → 0). Der Wert verschwand dabei zwar, aber um den Preis einer Warnung in jedem Nutzer-Log und eines angekündigten harten Fehlers. Stattdessen `dropClientsFolderType()`: lesen, und nur bei wirklich vorhandenem Feld per `setObject` ganz neu schreiben — kein Merge, nichts zu validieren, auf einer Anlage ohne Altlast passiert gar nichts. **Belegt am echten Aufstiegspfad:** die Vorgänger-Inventardatei trägt `clients` als `meta` mit `common.type: "meta.folder"`, und die Aufstiegs-Suite vergleicht seit v1.17.0 auch den OBJEKT-Typ, nicht nur `common.*` — vorher wäre eine gescheiterte Typ-Wanderung unsichtbar geblieben.

## Light-Typen

| Typ      | States                    | Model ID |
| -------- | ------------------------- | -------- |
| onoff    | on, bri                   | LWB007   |
| dimmable | on, bri                   | LWB010   |
| ct       | on, bri, ct               | LTW001   |
| color    | on, bri, hue, sat, ct, xy | LCT003   |

## Wertekonvertierung

- **bri**: 0-100% → 1-254, **sat**: 0-100% → 0-254 (je `briScale`/`satScale`)
- **hue**: raw 0-65535 oder Grad 0-360 (`hueScale`, I2), **ct**: raw Mired 153-500 oder Kelvin (`ctScale`, I2), **xy**: Array oder CSV → [x,y]
- **on**: via shared `coerceBool` (Allowlist `true/1/yes/on`, case-insensitiv; `"off"`/`"no"`/`"false"`/`""` → aus) (v1.10.0 M1)

## Tests (684 vitest inkl. Repo-Standard-Prüfungen + 57 Package-Tests + 1 Integration + Objekt-Inventar)

Runner: **vitest 5** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.mts`. Umstieg 4→5 am 2026-09-03 (krobis Entscheidung) — **ohne jede Anpassung an Tests oder Konfiguration**; vite 8 bringt rolldown statt rollup mit, die Sperrdatei trägt danach 26 esbuild-, 15 rolldown- und 11 lightningcss-Bindungen (Plattform-Vollständigkeit gegen den `npm ci`-Bruch geprüft, [[feedback_vitest_install_lockfile_pitfall]]). Über die volle CI-Matrix belegt: 9/9 grün, `adapter-tests` auf Ubuntu/Windows/macOS je unter Node 22 und 24.

**WICHTIG:** `.gitignore` ignoriert seit v1.17.0 `build/` (nogit-Regel, der Bau-Ausgang gehört nicht ins Repo). Ein früherer `*.js`-Eintrag mit Ausnahmen für `test/package.js`/`test/integration.js` existiert **nicht mehr** — die Behauptung stand bis zum Audit 2026-09-06 falsch hier (F9).

API-Drift-Härtung: incoming Hue-API bodies und foreign-state values werden type-guarded.

## FORBIDDEN_CHARS

`sanitizeId()` in `types/utils.ts` (shared) — ersetzt `[^A-Za-z0-9-_]` durch `_`.
Importiert von `user-service.ts` und `main.ts`. Betrifft: Client-Usernames (von Alexa/Harmony), migrierte Legacy-User.

## Versionshistorie

Aktuelle Version: `io-package.json`. **User-facing Changelog:** `README.md` + `io-package.json:common.news` (11 Sprachen, handgeschrieben). **Interne Entwicklungs-Historie** (Findings, Root-Causes, verworfene Wege): `.claude/dev-history.md` — lokal, nicht git-getrackt, bewusst aus dieser Datei ausgelagert um sie schlank zu halten.

## Befehle

```bash
npm run build            # Production (esbuild via build-adapter)
npm run check            # tsc --noEmit (Type-Check ohne Build)
npm run test:ts          # Unit-Tests via vitest (684 inkl. Repo-Standard-Prüfungen)
npm run test:unit        # Alias auf vitest — CI-Trigger der ioBroker testing-action (seit 2026-07-08)
npm run coverage         # vitest --coverage (v8)
npm run test:package     # Standard Package-Tests (57)
npm run test:integration # Standard Integration-Tests (1, CI only)
npm run test:inventory   # Objekt-Inventar aus Fixtures → test/objects.inventory.json (echte Kopplung über die HTTP-API)
npm test                 # test:ts + test:package (lokal)
npm run lint             # ESLint
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write (ohne build/, Manifest, README, alte Historie, Bot-Datei, Master-Datei)
npm run format:check     # Prettier --check (dieselben Ausnahmen) — grün
```
