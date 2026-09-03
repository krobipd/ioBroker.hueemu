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
src/main.ts                       → Adapter (Lifecycle, Pairing, TLS getOrCreateTlsMaterial, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards; refreshInstanceObjects — v1.15.0)
src/discovery/ssdp-server.ts      → UPnP/SSDP-Eigenbau auf node:dgram (fakeroku-Muster; Datagramme byte-identisch zur node-ssdp-4.0.1-Wire-Capture 2026-08-24; announce() vom Adapter-Interval getrieben, byebye bei stop)
src/discovery/ssdp-messages.ts    → reine SSDP-Datagramm-Builder + M-SEARCH-Parser (unit-getestet gegen die Capture)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + resetAutoAddBudget + whitelistProvider wireup + isKnownUser (reine Prüfung für /config) + Längengrenzen (Benutzername 64, Gerätetyp 100; v1.14.0)
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, parseLightIndex, hex uniqueid, xy round-trip, detectColorMode from mapped states; Cache nur für gemappte IDs, ungültige Zahlen beim Schreiben übersprungen — v1.14.0; brightnessImpliesOn/switchViaBrightness + resolveIncrements/applyIncrement — v1.15.0)
src/hue-api/user-service.ts       → Auth/Pairing (auto-add-cap 64/window, in-memory client-id cache, listCachedClientIds for whitelist, Stunden-Obergrenze 100 Neuanlagen über alle Pfade — v1.14.0; enforceCreateCeiling PRÜFT nur, countCreatedClient bucht nach echter Anlage — v1.15.0)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice; new HueEmuDeviceManagement(this) im main.ts-Konstruktor)
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping; adapter-agnostisch, gegen echten type-detector getestet). v1.15.0: Skalen-Ableitung (deriveLevelScale/deriveHueScale/deriveCtScale aus common.min/max/unit), Schreibbarkeitsprüfung am echten Objekt (stateFactsOf), TEMPERATURE auch bei hue/cie, MapOutcome mit UnmappedReason
src/lib/migrations.ts             → + runDeviceScaleBackfill (v1.15.0): füllt LEERE Skalen bestehender native.devices nach, einmalig in onReady, Neustart-Kurzschluss wie die Legacy-Migration
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parseLightIndex + parsePort (shared boundary helpers)
src/lib/i18n.ts                   → tName + t + tRaw (Rohtext in alle 11 Sprachen, v1.15.1): type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json)
src/server/hue-server.ts          → Fastify HTTP/HTTPS (trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints (+ GET /api/config ohne Benutzername, v1.14.0)
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors, hue-api, light, utils (sanitizeId + errText + oneLine über den ganzen C0-Bereich)
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

## Tests (624 vitest inkl. Repo-Standard-Prüfungen + 57 Package-Tests + 1 Integration)

Runner: **vitest 5** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.mts`. Umstieg 4→5 am 2026-09-03 (krobis Entscheidung) — **ohne jede Anpassung an Tests oder Konfiguration**; vite 8 bringt rolldown statt rollup mit, die Sperrdatei trägt danach 26 esbuild-, 15 rolldown- und 11 lightningcss-Bindungen (Plattform-Vollständigkeit gegen den `npm ci`-Bruch geprüft, [[feedback_vitest_install_lockfile_pitfall]]).

**WICHTIG:** .gitignore hat `*.js` — test/package.js und test/integration.js haben Ausnahmen!

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
npm run test:ts          # Unit-Tests via vitest (624 inkl. Repo-Standard-Prüfungen)
npm run test:unit        # Alias auf vitest — CI-Trigger der ioBroker testing-action (seit 2026-07-08)
npm run coverage         # vitest --coverage (v8)
npm run test:package     # Standard Package-Tests (57)
npm run test:integration # Standard Integration-Tests (1, CI only)
npm test                 # test:ts + test:package (lokal)
npm run lint             # ESLint
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write
npm run format:check     # Prettier --check
```
