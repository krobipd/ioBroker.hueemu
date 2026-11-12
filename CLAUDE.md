# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (Latest); Stable seit #6057 (2026-06-06) — welche Version dort steht, nur live (`show-adapter-repo-status.py`)
- **Herkunft:** Fork von Christopher Holomeks GitHub-Projekt (@holomekc, aktiv 2020-03 bis 2021-05). **Keine Übergabe** — nie auf npm, nie bei ioBroker eingereicht; krobi hat ab 2026-03 übernommen und das npm-Paket am 2026-03-16 erstveröffentlicht. Copyright/Credits-Zuordnung folgt der flottenweiten 4-Ebenen-Regel (Memory `reference_copyright_credits_rewrite`)
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-forge`, `uuid`, `@iobroker/dm-utils` (Geräte-Manager-Backend), `@iobroker/type-detector` (Licht-Scan). `node-ssdp` wurde v1.13.0 durch einen Eigenbau ersetzt (unmaintained seit 2020, unfixbarer `ip`-Advisory, verschluckte Bind-Fehler)
- **Test-Setup:** vitest (globals mode, pool: forks) — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/. **Die Test-Suiten laufen unter dem Lint** (seit 2026-09-02, Flotte): Attrappen ohne `await` als `Promise.resolve()/reject()`, Mock-Fabriken mit Rückgabetyp, `require-await` bleibt an. **Das Wurzel-`tsconfig.json` umfasst seit v1.17.1 `src/**/*.ts` UND `test/**/*.ts`** (Flotten-Master, offizielle Vorlage) — vorher prüfte `tsc --noEmit` die zwei `.ts`-Dateien unter `test/` (`test-helpers.ts`, `standards/repo-standards.test.ts`) gar nicht: `test/tsconfig.json` führt nur `./**/*.js`
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards; refreshInstanceObjects — v1.15.0; setConnected → info.connection/info.error — v1.17.0; Audit R-24: die Lichter als Objekte — `prepareLightObjects` (Höchststand, Piktogramm nachziehen), `scheduleLightReload`/`reloadLights` bedienen eine geänderte Lichtliste ohne Neustart; nach einem gescheiterten Start beendet `terminate` (UNCAUGHT_EXCEPTION) den Prozess, js-controller startet ihn neu (GV-28, belegter Port); `onMessage` beantwortet jedes unbekannte Kommando mit Rückruf mit einem Fehler (D10); ein gescheiterter Umzug bedient die Lichter der Einstellungen und lädt nichts nach; `prepareClients` lädt `clients.json` und zieht die Client-Objekte früherer Versionen um — nach den Lichtern, vor `refreshInstanceObjects`, dem API-Handler und dem Lauschen)
src/discovery/ssdp-server.ts      → UPnP/SSDP-Eigenbau auf node:dgram (fakeroku-Muster; Datagramme byte-identisch zur node-ssdp-4.0.1-Wire-Capture 2026-08-24; announce() vom Adapter-Interval getrieben, byebye bei stop)
src/discovery/ssdp-messages.ts    → reine SSDP-Datagramm-Builder + M-SEARCH-Parser (unit-getestet gegen die Capture)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + whitelistProvider wireup + isKnownUser (reine Prüfung für /config) + Längengrenzen (Benutzername 64, Gerätetyp 100; v1.14.0); Audit R-24: `replaceDevices` liest eine neue Lichtliste ganz ein, bevor sie die alte ersetzt (Änderungen dazwischen erreichen beide, Abos nur der alten enden danach)
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → Zustands-Cache + Licht-Aufbau + Schreibpfad (KEINE Umrechnung mehr, die liegt in lib/hue-scales.ts). ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, Licht-Id = permanente Nummer `DeviceConfig.id` + hex uniqueid daraus — v1.18.0; xy round-trip, detectColorMode from mapped states; Cache nur für gemappte IDs, `forgetState` bei gelöschtem Datenpunkt, ungültige Zahlen beim Schreiben übersprungen — v1.14.0; brightnessImpliesOn/switchViaBrightness + resolveIncrements/applyIncrement — v1.15.0; resolveScales = die EINZIGE Skalen-Ableitung, nur offene Felder, parallel — v1.18.0)
src/hue-api/light-state-keys.ts   → v1.18.0 die Attribute, die ein Licht-/Gruppenzustand kennt — alles andere antwortet Fehler 6; v1.19.0 `READ_ONLY_STATE_KEYS` (`colormode` → Fehler 8) (Entscheidung 27)
src/hue-api/user-service.ts       → Auth/Pairing (in-memory client-id cache — EIN geteilter Broker-Read beim Kaltstart + ein `addUser` je Schlüssel in flight, v1.18.0; listPairedClients für die Whitelist (Kopplungszeit = `lc` des Client-Zustands, Audit R-07); keine Obergrenze für Kopplungen, weder je Fenster noch je Stunde (Grundentscheidung K6); Audit R-24: der Schlüssel steht nur in `clients.json` (`ClientStore`), das Objekt heißt `clients.<modell>-<xxxx>` (Gerätetyp + letzte 4 Zeichen des Schlüssels) und trägt den Gerätetyp als Wert — `addUserOnce` schreibt den Dateieintrag vor dem Objekt und nimmt ihn zurück, wenn das Objekt scheitert; ein Schlüssel zählt nur, solange sein Objekt UND sein Dateieintrag stehen; `forgetClient` streicht ihn aus der Datei)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice). guardAction umschließt JEDEN registrierten Handler, loadDevices fängt selbst — ein Handler antwortet immer (Entscheidung 19). v1.18.0: Karten-Id = permanente Nummer (nie aus dem Formular), Scan-Dedup über JEDEN gebundenen Datenpunkt, Übersetzungsobjekt-Namen in Systemsprache (`useFormatDate` → `this.language`). Audit R-24: liest und schreibt die Lichter nur über den `LightStore` aus main.ts (`new HueEmuDeviceManagement(this, lights)` in onReady) — kein Neustart nach einer Änderung
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping; adapter-agnostisch, gegen echten type-detector getestet). Der Vorschlag trägt KEINE Skala — der Start leitet jede offene Skala aus dem gebundenen Datenpunkt ab (Entscheidung 20, Audit R-23); Schreibbarkeitsprüfung am echten Objekt (stateFactsOf), TEMPERATURE auch bei hue/cie, MapOutcome mit UnmappedReason
src/lib/migrations.ts             → Legacy-Geräte-Migration (die `createLight`-Geräte vor v1.1.0 werden Lichtobjekte, erst danach fallen ihre `.name`/`.data`-Hüllen), Aufräumen veralteter Objekte, + runLightObjectMigration (Audit R-24): zieht `native.devices` und `native.lastLightId` einmal in Lichtobjekte und die Markendatei — der Höchststand zuerst, jede Nummer bleibt, ein schon angelegtes Objekt bleibt; scheitert es, bedient der Lauf die Lichter der Einstellungen nummeriert aus dem Speicher und der nächste Start versucht es erneut. (Der persistierte Skalen-Nachzug von v1.15.0 ist v1.18.0 entfallen — Entscheidung 20/27)
src/lib/device-ids.ts             → v1.18.0 reine Helfer für die permanente Lichtnummer: isDeviceId, nextDeviceId (max(Nummern, Höchststand)+1 — v1.19.0), normalizeDevices (kaputte Einträge raus, v1.19.0), assignDeviceIds (erste Vergabe = Position, sonst oberhalb des Höchststands, idempotent)
src/lib/light-store.ts            → Audit R-24: die Lichter als Geräteobjekte `lights.<n>` (Name in 11 Sprachen, Piktogramm, Einstellungen in `native`), kein Kind darunter (krobi 2026-11-11 14:27); der Höchststand in `light-ids.json` im Datenordner. Alle Änderungen laufen durch EINE Warteschlange; `add` schreibt den Höchststand vor den Objekten (scheitert er, entsteht nichts), `save` schreibt das frisch gelesene Objekt ganz zurück, `remove` deckt die Nummer zuerst mit dem Höchststand, `reconcile` schreibt nur, was abweicht
src/lib/data-file.ts              → Flotten-Master (Runde 173), BYTE-GLEICHE Kopie (nie hier ändern; aus `.consistency-master/src/lib/`, samt `data-file.test.ts`): JEDER Zugriff auf den Datenordner der Instanz (`identity.json`, `light-ids.json`, `clients.json`) — Lesen (nichts / Wert / Grund), Schreiben (Temp-Datei, fsync, dann Umbenennen, 0600), Beiseitelegen, Löschen, Auflisten
src/lib/client-store.ts           → Audit R-24: die Schlüssel der gekoppelten Clients in `clients.json` (`{ clients: { "<id>": "<key>" } }`); Id = `slugOf(Gerätetyp)` + `-` + letzte 4 Buchstaben/Ziffern des Schlüssels (homeconnect-Muster `slugOf`; ohne Gerätetyp, `unknown`, `auto-paired` → `client`), bei Gleichstand `-2`, `-3`; `add` vergibt die Id einmal, synchron, und schreibt sie vor der Rückkehr (scheitert das Schreiben, bleibt die Tabelle wie sie war), ein erneut koppelnder Schlüssel behält seine Id, `reserve` sperrt die Ids, die der Baum ohne Dateieintrag hält; eine unlesbare Datei wird vor dem nächsten Schreiben als `clients.json.unreadable` beiseitegelegt, nie überschrieben; eine Logzeile nennt einen Schlüssel nie ganz (H-06): `keyForLog` (die Id seines Clients, sonst `…` + letzte 4 Zeichen), `urlForLog` (der Schlüsselteil von `/api/<key>/…` und ein Whitelist-Eintrag `/config/whitelist/<key>`, `/api/config` bleibt), `textForLog` (eine Fehlermeldung, die einen Schlüssel der URL wiederholt) und `objectIdForLog` (ein Objekt einer früheren Version unter `clients.`/`user.` — seine Id war der Schlüssel) — genutzt von api-handler, user-service, hue-server, Fehler-Handler und den Zustands-/Objekt-Ereignissen in main.ts
src/lib/client-move.ts            → Audit R-24: zieht `user.<key>` (vor v1.2.0) und `clients.<key>` (bis v1.19.0, erkannt an `native.username`, das jede Version schrieb) nach `clients.<modell>-<xxxx>` — erst der Dateieintrag, dann das neue Objekt (mit dem alten `common`, also Aufzeichnung und Smart-Name, und dem alten `lc` als Kopplungszeit), dann jeder Alias auf ein altes Objekt auf das neue (`retargetAliases`/`movedAliasTarget`, Form des Vorbilds homeconnect `device-move.ts`; Flottenstandard krobi 2026-11-12 20:02–20:06, gelesen nur bei einem Umzug, vor dem Löschen — danach weiß kein Start mehr, wohin ein altes Objekt zog), zuletzt die alten Objekte über `moveAllWithEnums`; jede Id, die unter `clients.` schon steht, ist reserviert; ein Dateieintrag ohne Objekt wird vergessen (nur bei lesbarer Datei)
src/lib/device-icons.ts           → Audit R-24: das Licht-Piktogramm `admin/icons/light.svg` als `data:image/svg+xml;base64,`-URI (CLAUDE_PATTERNS.md § Geräte-Piktogramme), Zeilenenden normalisiert, einmal je Start gelesen (der LightStore übernimmt es im Konstruktor — kein Cache)
src/lib/native-key-migration.ts   → Flotten-Master, BYTE-GLEICHE Kopie aus `.consistency-master/src/lib/` (nie hier ändern): Umbenennen/Wandeln/Nullen von `native`- und `common`-Schlüsseln in EINEM Merge, Neustart-Kurzschluss
src/lib/enum-carry.ts             → Flotten-Master, BYTE-GLEICHE Kopie (`moveAllWithEnums`): trägt beim Umzug der Client-Objekte (client-move.ts) Raum/Funktion mit (Enums einmal lesen → alle alten löschen → jedes Enum einmal mit allen Nachfolgern schreiben)
src/lib/native-key-list.ts        → v1.19.0 hueemus Tabelle dafür: `host` → `bind`, Port-Zahl, `advertiseHost` → `bind` nur wenn es das Verhalten hält, Drops (`native` + `common`, Entscheidung 33); Audit R-24: `udn`/`tlsCert`/`tlsKey` erst, wenn `identity.json` sie hält, `devices`/`lastLightId` erst, wenn die Lichtobjekte und der Höchststand stehen
src/lib/hue-scales.ts             → v1.17.0 ALLES über Hue-Werteskalen an EINER Stelle: Bereiche, beide Umrechnungsrichtungen, Ableitung aus common.min/max/unit, `SCALE_FIELDS` (Datenpunkt↔Skala, gelesen von der Start-Auflösung und der Umbinde-Regel des Geräte-Managers `resetReboundScales`), Inkremente, `HueStateKey` (die sechs abgebildeten Attribute — die Umrechnungen haben keinen default-Zweig). Rein — Logger als Parameter
src/lib/tls-material.ts           → v1.17.0 selbstsigniertes TLS (aus main.ts gezogen); rein — schreibt nicht selbst; `tlsPairUsable` prüft Schlüssel + Zertifikat per `createSecureContext`
src/lib/identity-store.ts         → Audit R-24: die Bridge-Identität (UDN, TLS-Paar, Schlüssel per `this.encrypt`) in `identity.json` im Datenordner der Instanz (`common.dataFolder`); `resolveIdentity` übernimmt beim ersten Start, was eine frühere Version in native ließ (Schlüssel verschlüsselt oder Klartext), `loadIdentity` in main.ts läuft VOR den native-Migrationen, die die alte Kopie erst nullen, wenn die Datei sie hält; die MAC bleibt ein Feld der Einstellungsseite, leer aus der UDN abgeleitet und nie geschrieben
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parsePort (shared boundary helpers)
src/lib/known-objects.ts          → Flotten-Master, BYTE-GLEICHE Kopie aus `.consistency-master/src/lib/` (nie hier ändern): `KnownObjects` liest den eigenen Baum einmal und schreibt nur, was abweicht — `refreshInstanceObjects` und `dropClientsFolderType` laufen darüber (Inventar-Suite „rewrites no object unchanged“)
src/lib/network-address.ts        → Flotten-Master, BYTE-GLEICHE Kopie: die gewählte Adresse (`bind`) ist die einzige, auf der der Adapter lauscht; `isOwnPeer` bedient nur Clients im eigenen Netz — Loopback zählt nicht, darum fragt die Inventar-Fixture auf der ersten nicht-internen IPv4
src/lib/err-text.ts               → Flotten-Master, BYTE-GLEICHE Kopie: `errText` — eine lesbare Zeile für alles, was ein `catch` bekommt
src/lib/i18n.ts                   → tName + t + tRaw (Rohtext in alle 11 Sprachen, v1.15.1): type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json); `nameIn` liest einen Objektnamen in der Systemsprache, sonst Englisch
src/server/hue-server.ts          → Fastify HTTP/HTTPS (`fastifyOptions()`: trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections, Router case-insensitiv + trailing slash — exportiert, die Routen-Tests bauen damit)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints (+ GET /api/config ohne Benutzername, v1.14.0); Fehler laufen in den serverweiten `hueErrorHandler`, keine eigene Abbildung mehr (v1.18.0)
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors (+ REASON_UNKNOWN + ConfigurationError, v1.17.0), hue-api, light, utils (oneLine über den ganzen C0-Bereich; `errText` liegt im Master `lib/err-text.ts`)
src-admin/                        → Admin-Komponente (Module Federation, Gerüst = Flotten-Master): nur `DevicesConfig` im Reiter „Geräte“, ruft `forgetLastTab` beim Ein- und Aushängen (GV-07 — die Einstellungen öffnen immer auf „Konfiguration“), zeigt nichts; Bau `npm run build:admin` → `admin/custom/` (versioniert, das npm-Paket trägt es)
docs/en/README.md, docs/de/README.md → Nutzerdoku fürs ioBroker-Doku-Portal (common.docs; ohne das Feld zeigt das Portal nur die README)
../scripts/sync-iopackage-from-i18n.py → hält io-package.json:instanceObjects synchron mit admin/i18n (zentral, source: admin-i18n)
```

## Design-Entscheidungen

_Je Nummer der Regel-Satz; Beleg, Messung und Verlauf wörtlich in `.claude/dev-history.md`, Eintrag „2026-09-25 — Design-Entscheidungen: Belege aus CLAUDE.md verlegt“ (Nummern 1–27 im Stand 1.18.0) und den Einträgen danach (u. a. v1.19.0; 36 und 37 im Eintrag „Review 2026-11-07“, Audit R-24)._

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
22. **Angemeldet wird gegen den ECHTEN Schlüssel, nie gegen eine Objekt-ID** — der Schlüssel kommt aus `clients.json`; die Id trägt nur seine letzten vier Zeichen und zählt nie als Schlüssel (Entscheidung 37).
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
37. **Die Client-Schlüssel liegen als Datei im Datenordner der Instanz (`clients.json`), nie im eigenen `native`, das Objekt heißt nach Gerätetyp und den letzten vier Zeichen des Schlüssels** — B02 `audit_own_native_at_runtime` (krobi 2026-11-05 22:46) und krobi 2026-11-10 14:34 „Datei im Datenordner“; die Id-Form `clients.harmony-hub-ac37` krobi 2026-11-11 14:25/14:27, nur für hueemu; einmal vergeben, bei Gleichstand mit Zähler; Zugang = Objekt UND Dateieintrag (Audit R-24).

<!-- core-decisions:begin (generated from the sealed register — change only through the Werkbank) -->

## Core decisions (sealed)

krobi's decisions for this adapter. The register with his verbatim words lives in the locked Werkbank tool tree; a change is a request to the Werkbank, never an edit here. Each guarded rule has a test under `src/decisions/`.

- **Z-01** hueemu is there first of all for the Logitech Harmony platform: the Harmony Hub drives the ioBroker devices through the emulated Hue bridge. Beside it for other devices and apps that only speak Hue (Bosch Smart Home Controller, older Echos, wall panels). It never switches a light the user did not assign; it grants no device access outside the pairing window.
- **H-02** Every light keeps its number for ever: deleting light 1 leaves light 2 as number 2, a new light gets the next number never given (4), never a freed one; the highest number ever given lives in a file in the instance's data folder.
- **H-03** The value scale is decided at start from the target datapoint: half brightness on a 0–100 % dimmer writes 50, not 127; no scale is written back into the settings.
- **H-04** Every change of a mapped datapoint reaches the bridge, also one with ack: false.
- **H-05** There is no test "device gone, device back": "connected" means the adapter runs, the ports are free and the settings fit. No datapoint shows whether an Echo or a Harmony Hub is there right now.
- **H-06** A paired device is named in the object tree after its device text and the last four characters of its key. If it names no text when pairing, 'client' stands in front; if the id is already taken, a counter follows. The key itself stands only in a file in the instance's data folder, not in the id, not in the value and not in the hidden data. Applies to hueemu only.
- **H-07** A light has no datapoint for its reachability. Applies to hueemu only.
- **K1** A new instance listens on port 8080 by default.
- **K2** A pure on/off light presents itself as a dimmable light, not as a color light.
- **K3** Pairing is open only in the pairing window (50 s after "pair"): every device that asks inside it gets access, none after it.
- **K4** HTTPS only when an HTTPS port is set; then hueemu creates its own certificate, valid ten years, and keeps it across restarts.
- **K5** The query of the bridge data never pairs: a search app asking inside the window gets the answer but no access.
- **K6** No limit for pairings: the 101st pairing within an hour is accepted like the first.
- **K7** An invalid value is not written (brightness "abc", an empty color), the device still gets success.
- **K8** A scale only with evidence at the datapoint: unit, min and max decide, never the role name; a color temperature without unit and limits gets no guessed scale.
- **K9** Off wins: "off, brightness 40 %" in one command switches off and writes no brightness; a dimmer without a switch: off = 0, on = full.
- **K10** Errors like the real bridge: a property no light knows gets an error; a known property the light lacks (color on a dimmer) gets success.
- **K11** Only the group "all lights" exists: any other group number gets "not available", no light changes.
- **K12** Writes fit the target datapoint: clamped to its min/max (6500 K), a read-only datapoint is not written, a text switch gets its own texts for on and off.
- **K13** A deleted paired device loses its access at once, also when deleted while the adapter was stopped (from the next start).
- **K14** The bridge reports a light to a paired device as 'not reachable' when no datapoint is assigned to it or the datapoint that switches it is missing (the switch; without a switch, the brightness). A missing color datapoint does not count.
- **K15** A light stands in the object tree under its number (lights.1, lights.2 …). Its name is the name the user gives it on the card, and it follows every rename there.

<!-- core-decisions:end -->

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

## Tests (1224 vitest inkl. Repo-Standard-Prüfungen und 21 Wächter unter `src/decisions/` + 62 Package-Tests, gemessen 2026-11-12; dazu Integration und Objekt-Inventar mit 16 Objekten)

Runner: **vitest 5** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.mts`. Umstieg 4→5 am 2026-09-03 (krobis Entscheidung) — **ohne jede Anpassung an Tests oder Konfiguration**; vite 8 bringt rolldown statt rollup mit, die Sperrdatei trägt danach 26 esbuild-, 15 rolldown- und 11 lightningcss-Bindungen (Plattform-Vollständigkeit gegen den `npm ci`-Bruch geprüft, [[feedback_vitest_install_lockfile_pitfall]]). Über die volle CI-Matrix belegt: `adapter-tests` auf Ubuntu/Windows/macOS je unter Node 22, 24 und 26 (9/9 grün, seit v1.18.0 mit 26.x — der Prüfbot verlangt die Matrix `[22.x, 24.x, 26.x]`, W3026; der Deploy-Step läuft auf 26.x).

**WICHTIG:** `.gitignore` ignoriert seit v1.17.0 `build/` (nogit-Regel, der Bau-Ausgang gehört nicht ins Repo). Ein früherer `*.js`-Eintrag mit Ausnahmen für `test/package.js`/`test/integration.js` existiert **nicht mehr** — die Behauptung stand bis zum Audit 2026-09-06 falsch hier (F9).

API-Drift-Härtung: incoming Hue-API bodies und foreign-state values werden type-guarded.

## Objekt-Ids

Zur Laufzeit legt der Adapter zwei Id-Formen an: `lights.<n>` — eine Nummer (Entscheidung 25) — und `clients.<modell>-<xxxx>` (Entscheidung 37). Der Gerätetyp eines Clients geht nur durch `slugOf` in die Id (Kleinbuchstaben, Ziffern, Bindestriche), vom Schlüssel nur die letzten vier Buchstaben oder Ziffern — das ist die Bereinigung; eine eigene nach `FORBIDDEN_CHARS` braucht der Adapter nicht.
