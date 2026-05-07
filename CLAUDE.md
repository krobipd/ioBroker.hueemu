# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version:** 1.4.0 (in progress — Multi-Language-Welle analog beszel v0.4.0 / hassemu v1.28.0 / govee v2.6.0: `lib/i18n-logs.ts` mit 25 LOG_STRINGS × 11 Sprachen + tLog Helper, `lib/i18n-states.ts` mit 5 STATE_NAMES × 11 Sprachen + tName Helper. Alle 23 user-facing Logs in main.ts/api-handler/user-service/device-binding/ssdp-server auf tLog umgestellt. errText aus types/utils.ts ersetzt 5 Inline `err instanceof Error`-Patterns + 5 raw `${error}`-Interpolationen. io-package.json instanceObjects (startPairing, disableAuth) common.name + common.desc auf Translation-Objects. NEU: `migrateInstanceObjectNames()` Helper für v1.3.x→v1.4.0 Upgrade-Pfad (idempotent via String-Check). Logger.silly() raus (dead code). HueApiHandler.isPairingEnabled() raus (dead code, no production caller). Baseline auf Node 22 + Admin >=7.8.23 + @types/node ^22.x + @tsconfig/node22, Deploy-Step PRE-EMPTIVE auf Node 24 (parcelapp v0.4.0 MODULE_NOT_FOUND-Workaround))
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (MERGED, im Latest-Repo)
- **Original Author:** Christopher Holomek (@holomekc) — Fork, modernisiert 2026
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-ssdp`, `node-forge`, `uuid`
- **Test-Setup:** offizieller ioBroker.example/TypeScript-Standard — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22.x` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, TLS-Cert, systemLang, migrateInstanceObjectNames)
src/discovery/ssdp-server.ts      → UPnP/SSDP (urn:schemas-upnp-org:device:Basic:1)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator
src/hue-api/config-service.ts     → Bridge Config
src/hue-api/device-binding-service.ts → ioBroker States ↔ Hue Lights
src/hue-api/user-service.ts       → Auth/Pairing (stores paired clients under "clients/")
src/lib/i18n-logs.ts              → 25 LOG_STRINGS × 11 Sprachen + tLog
src/lib/i18n-states.ts            → 5 STATE_NAMES × 11 Sprachen + tName
src/server/hue-server.ts          → Fastify HTTP/HTTPS
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints
src/types/                        → config, errors, hue-api, light, utils (sanitizeId + errText)
```

## Design-Entscheidungen

1. **Fastify** statt Express — schneller, besseres TypeScript-Support
2. **SSDP Port 1900 hardcoded** — UPnP-Standard, alle Clients scannen fix diesen Port
3. **host = bind + advertise** — IP wird für SSDP-Location UND Server-Bind verwendet → kein 0.0.0.0
4. **Port 8080 Default** — Harmony funktioniert mit 8080. Alexa neuere FW braucht Port 80 (User-Sache, README dokumentiert).
4. **onoff → LWB007/Dimmable** — Harmony kennt "On/Off light" nicht, fällt sonst auf Farb-Controls zurück
5. **capabilities-Feld weggelassen** — ha-bridge-kompatibel
6. **Pairing 50s Timeout** — Auto-Add aller Usernames während Fenster (Alexa/Harmony Kompatibilität)
7. **TLS self-signed** — 2048-bit RSA via node-forge, 10 Jahre Gültigkeit
8. **"clients" statt "user"** — Paired endpoints (Alexa, Harmony, Google Home) sind Clients, nicht User. "devices" = veröffentlichte Hue-Lichter

## Light-Typen

| Typ | States | Model ID |
|-----|--------|----------|
| onoff | on | LWB007 |
| dimmable | on, bri | LWB010 |
| ct | on, bri, ct | LTW001 |
| color | on, bri, hue, sat, ct, xy | LCT003 |

## Wertekonvertierung
- **bri**: 0-100% → 1-254, **sat**: 0-100% → 0-254, **hue**: beliebig → 0-65535
- **ct**: 153-500 Mireds (clamped), **xy**: Array oder CSV → [x,y]
- **on**: String "false" korrekt behandelt (v1.0.24 fix)

## Tests (246 custom + 57 standard + 1 integration = 304)

```
src/types/utils.test.ts                    → 18: sanitizeId (10) + errText (8)
src/types/errors.test.ts                   → 16: HueApiError, createSuccessResponse
src/types/config.test.ts                   → 25: generateBridgeId, generateSerialNumber, ConfigService
src/discovery/index.test.ts                → 10: UPnP description XML, URL building
src/hue-api/device-binding-service.test.ts → 109: DeviceBindingService, value conversion, edge cases
src/hue-api/user-service.test.ts           → 18: addUser sanitization, createUser, isUserAuthenticated
src/hue-api/api-handler.test.ts            → 16: auth/pairing gates, malformed devicetype, fallback (isPairingEnabled raus)
src/server/routes/api-v1-routes.test.ts    → 20: Fastify route tests (inject), body validation, auth
src/lib/i18n-logs.test.ts                  → 8: tLog Lang-Lookup + Token-Substitution + 11-Sprachen-Coverage
src/lib/i18n-states.test.ts                → 6: tName Translation-Objects + 11-Sprachen-Coverage + Migration-Keys
test/test-helpers.ts                       → Shared mock factories (no tests, ausserhalb src/)
test/package.js                            → 57 standard: @iobroker/testing packageFiles
test/integration.js                        → 1 standard: @iobroker/testing integration (CI only)
```

**WICHTIG:** .gitignore hat `*.js` — test/package.js und test/integration.js haben Ausnahmen!

API-Drift-Härtung: incoming Hue-API bodies und foreign-state values werden type-guarded.

## FORBIDDEN_CHARS

`sanitizeId()` in `types/utils.ts` (shared) — ersetzt `[^A-Za-z0-9-_]` durch `_`.
Importiert von `user-service.ts` und `main.ts`. Betrifft: Client-Usernames (von Alexa/Harmony), migrierte Legacy-User.

## Versionshistorie

| Version | Highlights |
|---------|------------|
| 1.4.0 | Multi-Language-Welle analog beszel v0.4.0: 25 LOG_STRINGS × 11 Sprachen (`lib/i18n-logs.ts`), 5 STATE_NAMES × 11 Sprachen (`lib/i18n-states.ts`). 23 user-facing Logs auf tLog umgestellt. errText helper in types/utils.ts. io-package.json instanceObjects mit Translation-Objects. `migrateInstanceObjectNames()` Helper für v1.3.x→v1.4.0 Upgrade-Pfad (idempotent). Logger.silly() + HueApiHandler.isPairingEnabled() raus (dead code). Baseline auf Node 22 + Admin >=7.8.23, Deploy-Step PRE-EMPTIVE auf Node 24 |
| 1.3.3 | admin/i18n auf upstream-Pattern (per-language subdirs), jsonConfig.json5 → jsonConfig.json |
| 1.3.2 | Doku-Welle: Release-Notes für v1.2.5–v1.3.1 in user-friendly Stil über alle 11 Sprachen |
| 1.3.1 | Translation-Hotfix: handgeschriebene 11-Sprachen-Übersetzungen für news[1.3.0]. `news.NEXT`-Pre-fill umgeht Translate-Adapter |
| 1.3.0 | Cleanup-Welle analog parcelapp v0.3.0 + beszel v0.3.8: format-scripts, supportedMessages.stopInstance:true, sources-dist-stable Auto-Sync |
| 1.2.9 | Audit-Cleanup gegen ioBroker.example/TypeScript-Vollstandard: Tests in `src/<sub>/*.test.ts`, dependabot ignore-Block, Tests 146 → 226 |
| 1.2.7 | tsconfig.test.json → outDir `./build-test`, `clients` als instanceObject, `.catch()`-Wrapper für onReady |

## Befehle

```bash
npm run build            # Production (esbuild via build-adapter)
npm run check            # tsc --noEmit (Type-Check ohne Build)
npm run test:ts          # Unit-Tests via ts-node (226)
npm run test:package     # Standard Package-Tests (57)
npm run test:integration # Standard Integration-Tests (1, CI only)
npm test                 # test:ts + test:package (lokal)
npm run lint             # ESLint
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write
npm run format:check     # Prettier --check
```
