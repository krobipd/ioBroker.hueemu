# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (MERGED, Latest); Stable seit #6720
- **Herkunft:** Fork von Christopher Holomeks GitHub-Projekt (@holomekc, aktiv 2020-03 bis 2021-05). **Keine Übergabe** — nie auf npm, nie bei ioBroker eingereicht; krobi hat ab 2026-03 übernommen und das npm-Paket am 2026-03-16 erstveröffentlicht. Copyright/Credits-Zuordnung folgt der flottenweiten 4-Ebenen-Regel (Memory `reference_copyright_credits_rewrite`)
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-forge`, `uuid`, `@iobroker/dm-utils` (Geräte-Manager-Backend), `@iobroker/type-detector` (Licht-Scan). `node-ssdp` wurde v1.13.0 durch einen Eigenbau ersetzt (unmaintained seit 2020, unfixbarer `ip`-Advisory, verschluckte Bind-Fehler)
- **Test-Setup:** vitest (globals mode, pool: forks) — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/. **Die Test-Suiten laufen unter dem Lint** (seit 2026-09-02, Flotte): Attrappen ohne `await` als `Promise.resolve()/reject()`, Mock-Fabriken mit Rückgabetyp, `require-await` bleibt an. **Das Wurzel-`tsconfig.json` umfasst seit v1.17.1 `src/**/*.ts` UND `test/**/*.ts`** (Flotten-Master, offizielle Vorlage) — vorher prüfte `tsc --noEmit` die zwei `.ts`-Dateien unter `test/` (`test-helpers.ts`, `standards/repo-standards.test.ts`) gar nicht: `test/tsconfig.json` führt nur `./**/*.js`
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards; refreshInstanceObjects — v1.15.0; setConnected → info.connection/info.error — v1.17.0)
src/discovery/ssdp-server.ts      → UPnP/SSDP-Eigenbau auf node:dgram (fakeroku-Muster; Datagramme byte-identisch zur node-ssdp-4.0.1-Wire-Capture 2026-08-24; announce() vom Adapter-Interval getrieben, byebye bei stop)
src/discovery/ssdp-messages.ts    → reine SSDP-Datagramm-Builder + M-SEARCH-Parser (unit-getestet gegen die Capture)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + resetAutoAddBudget + whitelistProvider wireup + isKnownUser (reine Prüfung für /config) + Längengrenzen (Benutzername 64, Gerätetyp 100; v1.14.0)
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → Zustands-Cache + Licht-Aufbau + Schreibpfad (KEINE Umrechnung mehr, die liegt in lib/hue-scales.ts). ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, Licht-Id = permanente Nummer `DeviceConfig.id` + hex uniqueid daraus — v1.18.0; xy round-trip, detectColorMode from mapped states; Cache nur für gemappte IDs, `forgetState` bei gelöschtem Datenpunkt, ungültige Zahlen beim Schreiben übersprungen — v1.14.0; brightnessImpliesOn/switchViaBrightness + resolveIncrements/applyIncrement — v1.15.0; resolveScales = die EINZIGE Skalen-Ableitung, nur offene Felder, parallel — v1.18.0)
src/hue-api/light-state-keys.ts   → v1.18.0 die Attribute, die ein Licht-/Gruppenzustand kennt — alles andere antwortet Fehler 6; v1.19.0 `READ_ONLY_STATE_KEYS` (`colormode` → Fehler 8) (Entscheidung 27)
src/hue-api/user-service.ts       → Auth/Pairing (auto-add-cap 64/window, in-memory client-id cache — EIN geteilter Broker-Read beim Kaltstart + ein `addUser` je Schlüssel in flight, v1.18.0; listCachedClientIds for whitelist, Stunden-Obergrenze 100 Neuanlagen über alle Pfade — v1.14.0; enforceCreateCeiling PRÜFT nur, countCreatedClient bucht nach echter Anlage — v1.15.0)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice; new HueEmuDeviceManagement(this) im main.ts-Konstruktor). guardAction umschließt JEDEN registrierten Handler, loadDevices fängt selbst — ein Handler antwortet immer (Entscheidung 19). v1.18.0: Karten-Id = permanente Nummer (nie aus dem Formular), Scan-Dedup über JEDEN gebundenen Datenpunkt, Übersetzungsobjekt-Namen in Systemsprache (`useFormatDate` → `this.language`)
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping; adapter-agnostisch, gegen echten type-detector getestet). v1.15.0: Skalen-Ableitung (deriveLevelScale/deriveHueScale/deriveCtScale aus common.min/max/unit), Schreibbarkeitsprüfung am echten Objekt (stateFactsOf), TEMPERATURE auch bei hue/cie, MapOutcome mit UnmappedReason
src/lib/migrations.ts             → Legacy-Geräte-Migration, Aufräumen veralteter Objekte, + runDeviceIdMigration (v1.18.0): nummeriert die Lichter einmalig, Neustart-Kurzschluss wie die Legacy-Migration, Write-Fehler → Nummern im Speicher. (Der persistierte Skalen-Nachzug von v1.15.0 ist v1.18.0 entfallen — Entscheidung 20/27)
src/lib/device-ids.ts             → v1.18.0 reine Helfer für die permanente Lichtnummer: isDeviceId, nextDeviceId (max(Nummern, Höchststand)+1 — v1.19.0), lightIdHighWater, normalizeDevices (kaputte Einträge raus, v1.19.0), assignDeviceIds (erste Vergabe = Position, idempotent)
src/lib/native-key-migration.ts   → Flotten-Master, BYTE-GLEICHE Kopie aus `.consistency-master/src/lib/` (nie hier ändern): Umbenennen/Wandeln/Nullen von `native`- und `common`-Schlüsseln in EINEM Merge, Neustart-Kurzschluss
src/lib/native-key-list.ts        → v1.19.0 hueemus Tabelle dafür: `host` → `bind`, Port-Zahl, `advertiseHost` → `bind` nur wenn es das Verhalten hält, Drops (`native` + `common`, Entscheidung 33)
src/lib/hue-scales.ts             → v1.17.0 ALLES über Hue-Werteskalen an EINER Stelle: Bereiche, beide Umrechnungsrichtungen, Ableitung aus common.min/max/unit (aus device-scan gezogen), Inkremente. Rein — Logger als Parameter
src/lib/tls-material.ts           → v1.17.0 selbstsigniertes TLS (aus main.ts gezogen); v1.18.0 rein — schreibt nicht mehr selbst, buildConfig speichert Identität + Zertifikat in EINEM Merge (Schlüssel per `this.encrypt`, v1.19.0); `tlsPairUsable` prüft Schlüssel + Zertifikat per `createSecureContext`
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parsePort (shared boundary helpers)
src/lib/i18n.ts                   → tName + t + tRaw (Rohtext in alle 11 Sprachen, v1.15.1): type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json)
src/server/hue-server.ts          → Fastify HTTP/HTTPS (`fastifyOptions()`: trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections, Router case-insensitiv + trailing slash — exportiert, die Routen-Tests bauen damit)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints (+ GET /api/config ohne Benutzername, v1.14.0); Fehler laufen in den serverweiten `hueErrorHandler`, keine eigene Abbildung mehr (v1.18.0)
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors (+ REASON_UNKNOWN + ConfigurationError, v1.17.0), hue-api, light, utils (sanitizeId + errText + oneLine über den ganzen C0-Bereich)
docs/en/README.md, docs/de/README.md → Nutzerdoku fürs ioBroker-Doku-Portal (common.docs; ohne das Feld zeigt das Portal nur die README)
../scripts/sync-iopackage-from-i18n.py → hält io-package.json:instanceObjects synchron mit admin/i18n (zentral, source: admin-i18n)
```

## Design-Entscheidungen

_Je Nummer der Regel-Satz; Beleg, Messung und Verlauf wörtlich in `.claude/dev-history.md`, Eintrag „2026-09-25 — Design-Entscheidungen: Belege aus CLAUDE.md verlegt“ (Nummern 1–27 im Stand 1.18.0) und je neue Nummer im Eintrag zu v1.19.0._

1. **Fastify** statt Express — schneller, besserer TypeScript-Support.
2. **SSDP Port 1900 hardcoded** — UPnP-Standard, alle Clients scannen fix diesen Port.
3. **`bind` = Bind + Advertise** — EIN `type:ip`-Feld: eine konkrete IP wird gebunden und angekündigt, `0.0.0.0` lauscht überall und kündigt eine erkannte routbare IP an; nie ein Lese-Fallback `bind || host`.
4. **Port 8080 Default** — Harmony funktioniert mit 8080; Alexa braucht Port 80 und (aktuelle Echos) zusätzlich HTTPS 443 — Nutzer-Sache, README und Doku beschreiben das Rezept.
5. **onoff → LWB007/Dimmable** — Harmony kennt "On/Off light" nicht, fällt sonst auf Farb-Controls zurück.
6. **capabilities-Feld weggelassen** — ha-bridge-kompatibel.
7. **Pairing 50 s Timeout** — Auto-Add aller Usernames während des Fensters; nur `POST /api` schließt es vorzeitig.
8. **TLS self-signed, der Schlüssel verschlüsselt gespeichert** — 2048-bit RSA, 10 Jahre; `tlsKey` geht durch `this.encrypt` (encryptedNative), ein Paar, das nicht zusammenpasst, wird neu erzeugt.
9. **"clients" statt "user"** — gekoppelte Endpunkte sind Clients, "devices" sind die veröffentlichten Hue-Lichter.
10. **`GET /api/config` öffentlich, `/api/<user>/config` und der Fallback ohne Auto-Aufnahme** — `isKnownUser` ist die reine Prüfung, damit ein Such-Poll im Kopplungsfenster nie zum Schlüssel wird.
11. **Stunden-Obergrenze 100 Neuanlagen** über alle Pfade — darüber Antwort 101, eine Warnung je Fenster.
12. **Längengrenzen für Client-Eingaben** — Benutzername > 64 Zeichen wird durch eine UUID ersetzt, Gerätetyp auf 100 Zeichen gekürzt.
13. **Ungültige Zahlen beim Schreiben werden übersprungen, nicht auf Vorgabe gesetzt** — quittiert, nichts geschrieben.
14. **Skalen werden abgeleitet, aber NUR mit Beleg am Zielobjekt** — `common.min`/`common.max`/`common.unit`, nie die Rolle; `%` an der Farbtemperatur → `percent`, `max 255` → `byte`.
15. **Beim Ausschalten gewinnt das Aus — für jedes Licht** — `bri` in einer Aus-Anfrage wird nicht geschrieben und mit Hue-Fehler 201 beantwortet; ein Licht ohne Schalt-Datenpunkt fährt über die Helligkeit (0 = aus, ein = volle Helligkeit).
16. **Relative Attribute (`bri_inc` & Co.) werden ausgeführt** — `_inc` neben dem absoluten Feld wird ignoriert, geklemmt außer `hue` (läuft modulo 65536 um), Antwort mit absoluter Adresse.
17. **Die eigenen Objekte bekommen bei jedem Start Name und Erklärung per `extendObject`** — js-controller wendet `instanceObjects` bei jedem Start an, bewahrt aber `common.name`; die übrige Form steht allein im Manifest.
18. **JEDER Datenpunkt trägt Namen UND Erklärung in 11 Sprachen — auch die zur Laufzeit erzeugten** — `tRaw()` legt den Gerätetyp eines Clients unter allen elf Sprachen ab.
19. **Ein Geräte-Manager-Handler antwortet IMMER** — `guardAction` umschließt jeden Einsprung, `loadDevices` fängt selbst.
20. **Die Werteskala wird beim START aufgelöst, nicht in der Konfiguration** — ohne Beleg entscheidet der letzte von 0 verschiedene QUELLwert, nie ein eigener Schreibwert oder dessen Echo.
21. **Eine Kopplung, die nicht in der Datenbank landet, ist keine Kopplung** — `addUser` wirft, der Client bekommt 101 und versucht es erneut.
22. **Angemeldet wird gegen den ECHTEN Schlüssel, nicht gegen die bereinigte Objekt-ID** — ein zweiter Schlüssel auf eine belegte ID wird abgelehnt.
23. **Der Adapter sagt im Objektbaum, ob er bedient** — `info.connection` + `info.error`; eine eigene Diagnose (`ConfigurationError`) trägt `Unknown`, nur ein Text von außen erreicht den Datenpunkt.
24. **Der `clients`-Ordner ist ein `folder`; ein alter `common.type` wird per Kopie entfernt** — lesen, Kopie ohne das Feld, `setForeignObject(<volle Id>)`; nie `null` im Patch.
25. **Jedes Licht trägt eine permanente Nummer, keine Nummer wird je wieder vergeben** — neu = `max(Nummern, native.lastLightId) + 1`, den Höchststand schreibt der Geräte-Manager mit; die Nummer kommt nie aus dem Formular.
26. **Jede Änderung eines gebundenen Datenpunkts erreicht den Licht-Cache, bestätigt oder nicht** — ein gelöschter Datenpunkt wird vergessen (`reachable: false`).
27. **Ein Attribut, das kein Lichtzustand kennt, bekommt Hue-Fehler 6** — ein nur lesbares (`colormode`) Fehler 8, `scene` an der Gruppe Fehler 7; ein bekanntes, hier nicht abgebildetes Attribut wird quittiert.
28. **Ein Hue-Body ist JSON, gleich welchen Content-Type die Anfrage nennt** — Parser für `*` mit Fastifys JSON-Parser; jeder Body-Parser-Fehler antwortet Typ 2.
29. **Nur Gruppe `0` existiert** — jede andere Gruppen-Id antwortet Typ 3, statt alle Lichter zu schalten.
30. **Der Schreibpfad richtet sich nach dem Ziel-Datenpunkt** — Zahlen auf `common.min`/`max` geklemmt, `write: false` wird nicht beschrieben, `on` in einen Text-Datenpunkt über ein wahr/falsch-Paar aus `common.states`.
31. **Ein gelöschter Client verliert seinen Zugang sofort** — das Zustands- und das Objekt-Ereignis unter `clients.*` widerrufen den Schlüssel im Speicher.
32. **Die Lichtsuche liefert jede Lampe einmal und liest `enum.functions`** — Treffer werden über die gebundenen Datenpunkte entdoppelt.
33. **Was ein früheres Manifest unter `native` oder `common` trug, wird beim Update genullt** — über den Flotten-Helfer mit hueemus Liste `native-key-list.ts`; `"connectionType "` (mit Leerzeichen) ist ein anderer Schlüssel als das heutige `connectionType`.
34. **Fehleradressen sind bridge-relativ** — `/lights/1/state`, `/` für die Wurzel, `""` bei Fehler 101; unbekannter Pfad: unbekannter Benutzer 1, bekannter 3.
35. **Zeitstempel im Bridge-Format `YYYY-MM-DDTHH:MM:SS`** — `/config` und Whitelist; die Whitelist trägt Gerätetyp und echtes Anlagedatum.

## Light-Typen

| Typ      | States                    | Model ID |
| -------- | ------------------------- | -------- |
| onoff    | on, bri                   | LWB007   |
| dimmable | on, bri                   | LWB010   |
| ct       | on, bri, ct               | LTW001   |
| color    | on, bri, hue, sat, ct, xy | LCT003   |

## Wertekonvertierung

- **bri**: 0-100% → 1-254, **sat**: 0-100% → 0-254 (je `briScale`/`satScale`; weitere Skalen `normalized` 0..1, `raw` 1..254, `byte` 0..255)
- **hue**: raw 0-65535 oder Grad 0-360 (`hueScale`, I2), **ct**: raw Mired 153-500, Kelvin oder Prozent 0..100 linear über 153..500, 0 = kalt (`ctScale`, I2; `percent` v1.19.0), **xy**: Array oder CSV → [x,y]
- **on**: via shared `coerceBool` (Allowlist `true/1/yes/on`, case-insensitiv; `"off"`/`"no"`/`"false"`/`""` → aus) (v1.10.0 M1)

## Tests (898 vitest inkl. Repo-Standard-Prüfungen + 61 Package-Tests + 1 Integration + Objekt-Inventar; Stand 2026-09-25)

Runner: **vitest 5** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.mts`. Umstieg 4→5 am 2026-09-03 (krobis Entscheidung) — **ohne jede Anpassung an Tests oder Konfiguration**; vite 8 bringt rolldown statt rollup mit, die Sperrdatei trägt danach 26 esbuild-, 15 rolldown- und 11 lightningcss-Bindungen (Plattform-Vollständigkeit gegen den `npm ci`-Bruch geprüft, [[feedback_vitest_install_lockfile_pitfall]]). Über die volle CI-Matrix belegt: `adapter-tests` auf Ubuntu/Windows/macOS je unter Node 22, 24 und 26 (9/9 grün, seit v1.18.0 mit 26.x — der Prüfbot verlangt die Matrix `[22.x, 24.x, 26.x]`, W3026; der Deploy-Step läuft auf 26.x).

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
npm run test:ts          # Unit-Tests via vitest (898 inkl. Repo-Standard-Prüfungen, 2026-09-25)
npm run test:unit        # Alias auf vitest — CI-Trigger der ioBroker testing-action (seit 2026-07-08)
npm run coverage         # vitest --coverage (v8)
npm run test:package     # Standard Package-Tests (61 mit @iobroker/testing 6.2.2)
npm run test:integration # Standard Integration-Tests (1, CI only)
npm run test:inventory   # Objekt-Inventar aus Fixtures → test/objects.inventory.json (echte Kopplung über die HTTP-API, gegen js-controller `stable` seit 2026-09-25, HTTPS-Port in der Fixture); läuft seit 2026-09-15 auch in der CI (Gate-Job adapter-inventory) — der Abzug wartet per waitForStableTree auf einen 4×250 ms ruhigen Objektsatz, eine feste Pause ist am Mac kalibriert, nicht am ubuntu-Runner
npm test                 # test:ts + test:package (lokal)
npm run lint             # ESLint
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write (ohne build/, Manifest, README, alte Historie, Bot-Datei, Master-Datei)
npm run format:check     # Prettier --check (dieselben Ausnahmen) — grün
```
