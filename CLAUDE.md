# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version:** 1.3.0 (2026-05-01 — Cleanup-Welle analog parcelapp v0.3.0 + beszel v0.3.8)
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (MERGED, im Latest-Repo)
- **Original Author:** Christopher Holomek (@holomekc) — Fork, modernisiert 2026
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-ssdp`, `node-forge`, `uuid`
- **Test-Setup:** offizieller ioBroker.example/TypeScript-Standard — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/
- **`@types/node` an `engines.node`-Min gekoppelt:** `^20.x` weil `engines.node: ">=20"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, TLS-Cert)
src/discovery/ssdp-server.ts      → UPnP/SSDP (urn:schemas-upnp-org:device:Basic:1)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator
src/hue-api/config-service.ts     → Bridge Config
src/hue-api/device-binding-service.ts → ioBroker States ↔ Hue Lights
src/hue-api/user-service.ts       → Auth/Pairing (stores paired clients under "clients/")
src/server/hue-server.ts          → Fastify HTTP/HTTPS
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints
src/types/                        → config, errors, hue-api, light
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

## Tests (226 custom + 57 standard + 1 integration = 284)

```
src/types/utils.test.ts                    → 10: sanitizeId (shared utility)
src/types/errors.test.ts                   → 16: HueApiError, createSuccessResponse
src/types/config.test.ts                   → 25: generateBridgeId, generateSerialNumber, ConfigService
src/discovery/index.test.ts                → 10: UPnP description XML, URL building
src/hue-api/device-binding-service.test.ts → 109: DeviceBindingService, value conversion, edge cases (NaN/Infinity/objects)
src/hue-api/user-service.test.ts           → 18: addUser sanitization, createUser, isUserAuthenticated
src/hue-api/api-handler.test.ts            → 18: auth/pairing gates, malformed devicetype, fallback
src/server/routes/api-v1-routes.test.ts    → 20: Fastify route tests (inject), body validation, auth
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
| 1.3.0 | Cleanup-Welle analog parcelapp v0.3.0 + beszel v0.3.8: `format`/`format:check` npm-scripts, `supportedMessages.stopInstance: true`, Workflow `repochecker-version-gate` auf sources-dist-stable, `tsconfig.build.json` exclude entdoppelt, CLAUDE.md Tests-Sektion + Befehle aktualisiert. Auto via release-mode: js-controller `>=7.0.7`, admin `>=7.7.22` |
| 1.2.9 | Audit-Cleanup gegen ioBroker.example/TypeScript-Vollstandard: tsconfig.test.json gelöscht, Tests in `src/<sub>/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` ausserhalb src/, dependabot ignore-Block, Tests 146 → 226 |
| 1.2.7 | tsconfig.test.json → outDir `./build-test` (verhindert `build/src`+`build/test`-Duplikate), `clients` als instanceObject (meta/folder, 11-sprachig), `.catch()`-Wrapper für onReady (defense-in-depth) |
| 1.2.6 | API-Boundary-Härtung: Type-Guards für eingehende Hue-Bodies, numerische Koerzierung (NaN/Infinity/Schrottwerte) für bri/hue/sat/ct/xy, Tests 146 → 226 |
| 1.2.5 | Docs-Release: Matter-aware repositioning, Metadaten in 11 Sprachen neu geschrieben, Harmony-Namedrop aus i18n raus |
| 1.2.4 | Dead code cleanup, DRY (requireAuth, BRIDGE_MODEL_ID), UserService async, try/finally onUnload, logger required |
| 1.2.3 | DRY refactoring (sanitizeId, Hue-Konstanten), Tests aufgeteilt (5 Module) |
| 1.2.2 | CI cleanup (actions/checkout entfernt), readme URL master→main |
| 1.2.1 | Standard-Tests (integration.js, package.js), FORBIDDEN_CHARS sanitization, CHANGELOG.md entfernt |
| 1.2.0 | Rename user→clients, Auto-Migration |
| 1.1.0 | Legacy createLight entfernt, Auto-Migration |
| 1.0.22 | Code-Review mcm1957: FORBIDDEN_CHARS, this.setTimeout, CI cross-platform |
| 1.0.0 | Major Rewrite: Fastify, moderne Admin UI |

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
