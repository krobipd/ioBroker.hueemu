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
src/main.ts                       → Adapter (Lifecycle, Pairing, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards; refreshInstanceObjects — v1.15.0; setConnected → info.connection/info.error — v1.17.0; Audit R-24: die Lichter als Objekte — `prepareLightObjects` (Höchststand, Form nachziehen, Erreichbarkeit vorlesen), `writeReachability` nur bei Änderung, `scheduleLightReload`/`reloadLights` bedienen eine geänderte Lichtliste ohne Neustart, `markLightsUnreachable` beim Stopp und nach einem gescheiterten Start, danach beendet `terminate` (UNCAUGHT_EXCEPTION) den Prozess, js-controller startet ihn neu (GV-28, belegter Port); `onMessage` beantwortet jedes unbekannte Kommando mit Rückruf mit einem Fehler (D10); ein gescheiterter Umzug bedient die Lichter der Einstellungen und lädt nichts nach; `prepareClients` lädt `clients.json` und zieht die Client-Objekte früherer Versionen um — nach den Lichtern, vor `refreshInstanceObjects`, dem API-Handler und dem Lauschen)
src/discovery/ssdp-server.ts      → UPnP/SSDP-Eigenbau auf node:dgram (fakeroku-Muster; Datagramme byte-identisch zur node-ssdp-4.0.1-Wire-Capture 2026-08-24; announce() vom Adapter-Interval getrieben, byebye bei stop)
src/discovery/ssdp-messages.ts    → reine SSDP-Datagramm-Builder + M-SEARCH-Parser (unit-getestet gegen die Capture)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + whitelistProvider wireup + isKnownUser (reine Prüfung für /config) + Längengrenzen (Benutzername 64, Gerätetyp 100; v1.14.0); Audit R-24: `replaceDevices` liest eine neue Lichtliste ganz ein, bevor sie die alte ersetzt (Änderungen dazwischen erreichen beide, Abos nur der alten enden danach), `reachability()` je Lichtnummer
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → Zustands-Cache + Licht-Aufbau + Schreibpfad (KEINE Umrechnung mehr, die liegt in lib/hue-scales.ts). ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, Licht-Id = permanente Nummer `DeviceConfig.id` + hex uniqueid daraus — v1.18.0; xy round-trip, detectColorMode from mapped states; Cache nur für gemappte IDs, `forgetState` bei gelöschtem Datenpunkt, ungültige Zahlen beim Schreiben übersprungen — v1.14.0; brightnessImpliesOn/switchViaBrightness + resolveIncrements/applyIncrement — v1.15.0; resolveScales = die EINZIGE Skalen-Ableitung, nur offene Felder, parallel — v1.18.0)
src/hue-api/light-state-keys.ts   → v1.18.0 die Attribute, die ein Licht-/Gruppenzustand kennt — alles andere antwortet Fehler 6; v1.19.0 `READ_ONLY_STATE_KEYS` (`colormode` → Fehler 8) (Entscheidung 27)
src/hue-api/user-service.ts       → Auth/Pairing (in-memory client-id cache — EIN geteilter Broker-Read beim Kaltstart + ein `addUser` je Schlüssel in flight, v1.18.0; listPairedClients für die Whitelist (Kopplungszeit = `lc` des Client-Zustands, Audit R-07); keine Obergrenze für Kopplungen, weder je Fenster noch je Stunde (Grundentscheidung K6); Audit R-24: der Schlüssel steht nur in `clients.json` (`ClientStore`), das Objekt heißt `clients.<n>` und trägt den Gerätetyp als Wert — `addUserOnce` schreibt den Dateieintrag vor dem Objekt und nimmt ihn zurück, wenn das Objekt scheitert; ein Schlüssel zählt nur, solange sein Objekt UND sein Dateieintrag stehen; `forgetClient` streicht ihn aus der Datei)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice). guardAction umschließt JEDEN registrierten Handler, loadDevices fängt selbst — ein Handler antwortet immer (Entscheidung 19). v1.18.0: Karten-Id = permanente Nummer (nie aus dem Formular), Scan-Dedup über JEDEN gebundenen Datenpunkt, Übersetzungsobjekt-Namen in Systemsprache (`useFormatDate` → `this.language`). Audit R-24: liest und schreibt die Lichter nur über den `LightStore` aus main.ts (`new HueEmuDeviceManagement(this, lights)` in onReady) — kein Neustart nach einer Änderung
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping; adapter-agnostisch, gegen echten type-detector getestet). Der Vorschlag trägt KEINE Skala — der Start leitet jede offene Skala aus dem gebundenen Datenpunkt ab (Entscheidung 20, Audit R-23); Schreibbarkeitsprüfung am echten Objekt (stateFactsOf), TEMPERATURE auch bei hue/cie, MapOutcome mit UnmappedReason
src/lib/migrations.ts             → Legacy-Geräte-Migration (die `createLight`-Geräte vor v1.1.0 werden Lichtobjekte, erst danach fallen ihre `.name`/`.data`-Hüllen), Aufräumen veralteter Objekte, + runLightObjectMigration (Audit R-24): zieht `native.devices` und `native.lastLightId` einmal in Lichtobjekte und die Markendatei — der Höchststand zuerst, jede Nummer bleibt, ein schon angelegtes Objekt bleibt; scheitert es, bedient der Lauf die Lichter der Einstellungen nummeriert aus dem Speicher und der nächste Start versucht es erneut. (Der persistierte Skalen-Nachzug von v1.15.0 ist v1.18.0 entfallen — Entscheidung 20/27)
src/lib/device-ids.ts             → v1.18.0 reine Helfer für die permanente Lichtnummer: isDeviceId, nextDeviceId (max(Nummern, Höchststand)+1 — v1.19.0), normalizeDevices (kaputte Einträge raus, v1.19.0), assignDeviceIds (erste Vergabe = Position, sonst oberhalb des Höchststands, idempotent)
src/lib/light-store.ts            → Audit R-24: die Lichter als Geräteobjekte `lights.<n>` (Name in 11 Sprachen, Piktogramm, `statusStates.onlineId`, Einstellungen in `native`) mit dem Kind `lights.<n>.reachable`; der Höchststand in `light-ids.json` im Datenordner. Alle Änderungen laufen durch EINE Warteschlange; `add` schreibt den Höchststand vor den Objekten (scheitert er, entsteht nichts), `save` schreibt das frisch gelesene Objekt ganz zurück, `remove` deckt die Nummer zuerst mit dem Höchststand, `reconcile` schreibt nur, was abweicht
src/lib/data-file.ts              → Flotten-Master (Runde 173), BYTE-GLEICHE Kopie (nie hier ändern; bis zum GO aus `Ressourcen/werkbank-vorab/`, danach aus `.consistency-master/src/lib/`, samt `data-file.test.ts`): JEDER Zugriff auf den Datenordner der Instanz (`identity.json`, `light-ids.json`, `clients.json`) — Lesen (nichts / Wert / Grund), Schreiben (Temp-Datei + Umbenennen, 0600), Beiseitelegen, Löschen, Auflisten
src/lib/client-store.ts           → Audit R-24 (Werkbank-Standard Runde 173): die Schlüssel der gekoppelten Clients in `clients.json` (`{ lastClientId, clients: { "<n>": "<key>" } }`); `add` vergibt die Nummer synchron und schreibt sie vor der Rückkehr (scheitert das Schreiben, bleibt die Tabelle wie sie war), keine Nummer wird je wieder vergeben (`lastClientId`), eine unlesbare Datei wird vor dem nächsten Schreiben als `clients.json.unreadable` beiseitegelegt, nie überschrieben
src/lib/client-move.ts            → Audit R-24: zieht `user.<key>` (vor v1.2.0) und `clients.<key>` (bis v1.19.0) nach `clients.<n>` — erst der Dateieintrag, dann das neue Objekt (mit dem alten `common`, also Aufzeichnung und Smart-Name, und dem alten `lc` als Kopplungszeit), zuletzt die alten Objekte über `moveAllWithEnums`; der Höchststand deckt jede Nummer, die unter `clients.` schon steht; ein Dateieintrag ohne Objekt wird vergessen (nur bei lesbarer Datei)
src/lib/device-icons.ts           → Audit R-24: das Licht-Piktogramm `admin/icons/light.svg` als `data:image/svg+xml;base64,`-URI (CLAUDE_PATTERNS.md § Geräte-Piktogramme), Zeilenenden normalisiert, einmal je Start gelesen (der LightStore übernimmt es im Konstruktor — kein Cache)
src/lib/native-key-migration.ts   → Flotten-Master, BYTE-GLEICHE Kopie aus `.consistency-master/src/lib/` (nie hier ändern): Umbenennen/Wandeln/Nullen von `native`- und `common`-Schlüsseln in EINEM Merge, Neustart-Kurzschluss
src/lib/enum-carry.ts             → Flotten-Master, BYTE-GLEICHE Kopie (`moveAllWithEnums`): trägt beim Umzug der Client-Objekte nach `clients.<n>` (client-move.ts) Raum/Funktion mit (Enums einmal lesen → alle alten löschen → jedes Enum einmal mit allen Nachfolgern schreiben)
src/lib/native-key-list.ts        → v1.19.0 hueemus Tabelle dafür: `host` → `bind`, Port-Zahl, `advertiseHost` → `bind` nur wenn es das Verhalten hält, Drops (`native` + `common`, Entscheidung 33); Audit R-24: `udn`/`tlsCert`/`tlsKey` erst, wenn `identity.json` sie hält, `devices`/`lastLightId` erst, wenn die Lichtobjekte und der Höchststand stehen
src/lib/hue-scales.ts             → v1.17.0 ALLES über Hue-Werteskalen an EINER Stelle: Bereiche, beide Umrechnungsrichtungen, Ableitung aus common.min/max/unit, `SCALE_FIELDS` (Datenpunkt↔Skala, gelesen von der Start-Auflösung und der Umbinde-Regel des Geräte-Managers `resetReboundScales`), Inkremente, `HueStateKey` (die sechs abgebildeten Attribute — die Umrechnungen haben keinen default-Zweig). Rein — Logger als Parameter
src/lib/tls-material.ts           → v1.17.0 selbstsigniertes TLS (aus main.ts gezogen); rein — schreibt nicht selbst; `tlsPairUsable` prüft Schlüssel + Zertifikat per `createSecureContext`
src/lib/identity-store.ts         → Audit R-24: die Bridge-Identität (UDN, TLS-Paar, Schlüssel per `this.encrypt`) in `identity.json` im Datenordner der Instanz (`common.dataFolder`); `resolveIdentity` übernimmt beim ersten Start, was eine frühere Version in native ließ (Schlüssel verschlüsselt oder Klartext), `loadIdentity` in main.ts läuft VOR den native-Migrationen, die die alte Kopie erst nullen, wenn die Datei sie hält; die MAC bleibt ein Feld der Einstellungsseite, leer aus der UDN abgeleitet und nie geschrieben
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parsePort (shared boundary helpers)
src/lib/i18n.ts                   → tName + t + tRaw (Rohtext in alle 11 Sprachen, v1.15.1): type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json); `nameIn` liest einen Objektnamen in der Systemsprache, sonst Englisch
src/server/hue-server.ts          → Fastify HTTP/HTTPS (`fastifyOptions()`: trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections, Router case-insensitiv + trailing slash — exportiert, die Routen-Tests bauen damit)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints (+ GET /api/config ohne Benutzername, v1.14.0); Fehler laufen in den serverweiten `hueErrorHandler`, keine eigene Abbildung mehr (v1.18.0)
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors (+ REASON_UNKNOWN + ConfigurationError, v1.17.0), hue-api, light, utils (errText + oneLine über den ganzen C0-Bereich)
src-admin/                        → Admin-Komponente (Module Federation, Gerüst = Flotten-Master): nur `DevicesConfig` im Reiter „Geräte“, ruft `forgetLastTab` beim Ein- und Aushängen (GV-07 — die Einstellungen öffnen immer auf „Konfiguration“), zeigt nichts; Bau `npm run build:admin` → `admin/custom/` (versioniert, das npm-Paket trägt es)
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
8. **TLS self-signed, der Schlüssel verschlüsselt gespeichert** — 2048-bit RSA, 10 Jahre; `tlsKey` geht durch `this.encrypt` (in `identity.json`, Entscheidung 36), ein Paar, das nicht zusammenpasst, wird neu erzeugt.
9. **"clients" statt "user"** — gekoppelte Endpunkte sind Clients, "devices" sind die veröffentlichten Hue-Lichter.
10. **`GET /api/config` öffentlich, `/api/<user>/config` und der Fallback ohne Auto-Aufnahme** — `isKnownUser` ist die reine Prüfung, damit ein Such-Poll im Kopplungsfenster nie zum Schlüssel wird.
11. **Keine Grenze für Kopplungen** — jedes Gerät, das sich im Fenster meldet, wird gekoppelt, ohne Obergrenze je Fenster oder Stunde (Grundentscheidung K6, krobi 2026-11-10 16:10, abgenommen 2026-11-11 07:37).
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
22. **Angemeldet wird gegen den ECHTEN Schlüssel, nie gegen eine Objekt-ID** — der Schlüssel kommt aus `clients.json`, die Id `clients.<n>` trägt nichts von ihm (Entscheidung 37).
23. **Der Adapter sagt im Objektbaum, ob er bedient** — `info.connection` + `info.error`; eine eigene Diagnose (`ConfigurationError`) trägt `Unknown`, nur ein Text von außen erreicht den Datenpunkt.
24. **Der `clients`-Ordner ist ein `folder`; ein alter `common.type` wird per Kopie entfernt** — lesen, Kopie ohne das Feld, `setForeignObject(<volle Id>)`; nie `null` im Patch.
25. **Jedes Licht trägt eine permanente Nummer, keine Nummer wird je wieder vergeben** — neu = `max(Nummern, Höchststand) + 1`; den Höchststand hält eine Datei im Datenordner der Instanz (`light-ids.json`); die Nummer kommt nie aus dem Formular.
26. **Jede Änderung eines gebundenen Datenpunkts erreicht den Licht-Cache, bestätigt oder nicht** — ein gelöschter Datenpunkt wird vergessen (`reachable: false`).
27. **Ein Attribut, das kein Lichtzustand kennt, bekommt Hue-Fehler 6** — ein nur lesbares (`colormode`) Fehler 8, `scene` an der Gruppe Fehler 7; ein bekanntes, hier nicht abgebildetes Attribut wird quittiert.
28. **Ein Hue-Body ist JSON, gleich welchen Content-Type die Anfrage nennt** — Parser für `*` mit Fastifys JSON-Parser; jeder Body-Parser-Fehler antwortet Typ 2.
29. **Nur Gruppe `0` existiert** — jede andere Gruppen-Id antwortet Typ 3, statt alle Lichter zu schalten.
30. **Der Schreibpfad richtet sich nach dem Ziel-Datenpunkt** — Zahlen auf `common.min`/`max` geklemmt, `write: false` wird nicht beschrieben, `on` in einen Text-Datenpunkt über ein wahr/falsch-Paar aus `common.states`.
31. **Ein gelöschter Client verliert seinen Zugang sofort** — das Zustands- und das Objekt-Ereignis unter `clients.*` widerrufen den Schlüssel im Speicher und in `clients.json`; ein Objekt, das bei gestopptem Adapter gelöscht wurde, streicht der nächste Start aus der Datei.
32. **Die Lichtsuche liefert jede Lampe einmal und liest `enum.functions`** — Treffer werden über die gebundenen Datenpunkte entdoppelt.
33. **Was ein früheres Manifest unter `native` oder `common` trug, wird beim Update genullt** — über den Flotten-Helfer mit hueemus Liste `native-key-list.ts`; `"connectionType "` (mit Leerzeichen) ist ein anderer Schlüssel als das heutige `connectionType`.
34. **Fehleradressen sind bridge-relativ** — `/lights/1/state`, `/` für die Wurzel, `""` bei Fehler 101; unbekannter Pfad: unbekannter Benutzer 1, bekannter 3.
35. **Zeitstempel im Bridge-Format `YYYY-MM-DDTHH:MM:SS`** — `/config` und Whitelist; die Whitelist trägt Gerätetyp und echtes Anlagedatum.
36. **Die Bridge-Identität liegt im Datenordner der Instanz, nie im eigenen `native`** — UDN und TLS-Paar in `identity.json`; die Kopie einer früheren Version in native wird erst genullt, wenn die Datei sie hält (Audit R-24).
37. **Die Client-Schlüssel folgen dem Flottenstandard „ein erzeugtes Geheimnis nur als Datei im Datenordner“ (Runde 173, krobi 2026-11-10 14:34, im Register als Flottenregel mit Gate)** — hier `clients.json`, das Objekt heißt `clients.<n>`, keine Client-Nummer wird je wieder vergeben, Zugang = Objekt UND Dateieintrag (Audit R-24).

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
- **on**: via shared `coerceBool` (Allowlist `ON_WORDS` in `lib/coerce.ts` — `on/true/1/yes/an/ein`, case-insensitiv; alles andere → aus); dieselbe Liste mit `OFF_WORDS` wählt beim Schreiben den Schlüssel eines Text-Schalters (Audit R-01)

## Tests (898 vitest inkl. Repo-Standard-Prüfungen + 61 Package-Tests + 1 Integration + Objekt-Inventar; Stand 2026-09-25)

Runner: **vitest 5** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.mts`. Umstieg 4→5 am 2026-09-03 (krobis Entscheidung) — **ohne jede Anpassung an Tests oder Konfiguration**; vite 8 bringt rolldown statt rollup mit, die Sperrdatei trägt danach 26 esbuild-, 15 rolldown- und 11 lightningcss-Bindungen (Plattform-Vollständigkeit gegen den `npm ci`-Bruch geprüft, [[feedback_vitest_install_lockfile_pitfall]]). Über die volle CI-Matrix belegt: `adapter-tests` auf Ubuntu/Windows/macOS je unter Node 22, 24 und 26 (9/9 grün, seit v1.18.0 mit 26.x — der Prüfbot verlangt die Matrix `[22.x, 24.x, 26.x]`, W3026; der Deploy-Step läuft auf 26.x).

**WICHTIG:** `.gitignore` ignoriert seit v1.17.0 `build/` (nogit-Regel, der Bau-Ausgang gehört nicht ins Repo). Ein früherer `*.js`-Eintrag mit Ausnahmen für `test/package.js`/`test/integration.js` existiert **nicht mehr** — die Behauptung stand bis zum Audit 2026-09-06 falsch hier (F9).

API-Drift-Härtung: incoming Hue-API bodies und foreign-state values werden type-guarded.

## Objekt-Ids

Jede Id, die der Adapter zur Laufzeit anlegt, ist eine Nummer: `lights.<n>` (Entscheidung 25), `clients.<n>` (Entscheidung 37). Kein Text von außen (Benutzername, Gerätetyp) wird Teil einer Id — darum braucht der Adapter keine Bereinigung nach `FORBIDDEN_CHARS`.
