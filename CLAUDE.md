# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für ältere Geräte, die nur die Hue-API sprechen. Moderne Voice Assistants sollen ioBroker.matter nutzen.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634 (MERGED, im Latest-Repo)
- **Herkunft:** Fork von Christopher Holomeks GitHub-Projekt (@holomekc, aktiv 2020-03 bis 2021-05). **Keine Übergabe** — nie auf npm, nie bei ioBroker eingereicht; krobi hat ab 2026-03 übernommen und das npm-Paket am 2026-03-16 erstveröffentlicht. Copyright/Credits-Zuordnung folgt der flottenweiten 4-Ebenen-Regel (Memory `reference_copyright_credits_rewrite`)
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-ssdp`, `node-forge`, `uuid`, `@iobroker/dm-utils` (Geräte-Manager-Backend), `@iobroker/type-detector` (Licht-Scan)
- **Test-Setup:** vitest (globals mode, pool: forks) — Tests neben Source unter `src/**/*.test.ts` (modulare Sub-Folders), `test/test-helpers.ts` als Shared-Mock-Factory außerhalb src/
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                       → Adapter (Lifecycle, Pairing, TLS getOrCreateTlsMaterial, systemLang, migrations, parallel-start HTTP-first-then-SSDP, ackState fire-and-forget guards)
src/discovery/ssdp-server.ts      → UPnP/SSDP (urn:schemas-upnp-org:device:Basic:1)
src/discovery/description-xml.ts  → UPnP XML
src/hue-api/api-handler.ts        → API Orchestrator + resetAutoAddBudget + whitelistProvider wireup
src/hue-api/config-service.ts     → Bridge Config (IPv4-gateway, IANA-tz, whitelist from provider)
src/hue-api/device-binding-service.ts → ioBroker States ↔ Hue Lights (parallel refresh/getAllLights, parseLightIndex, hex uniqueid, xy round-trip, detectColorMode from mapped states)
src/hue-api/user-service.ts       → Auth/Pairing (auto-add-cap 64/window, in-memory client-id cache, listCachedClientIds for whitelist)
src/device-management.ts          → v1.11.0 Geräte-Manager-Backend (DeviceManagement-Subklasse: loadDevices/getInstanceInfo, Aktionen add/edit/delete/search, buildDeviceForm, cleanDevice; new HueEmuDeviceManagement(this) im main.ts-Konstruktor)
src/lib/device-scan.ts            → v1.11.0 reine Licht-Discovery (ChannelDetector → DeviceConfig-Mapping, RGB=unmapped; adapter-agnostisch, gegen echten type-detector getestet)
src/lib/coerce.ts                 → coerceBool + coerceFiniteNumber + parseLightIndex + parsePort (shared boundary helpers)
src/lib/i18n.ts                   → tName + t: type-safe I18n.getTranslatedObject wrapper (t mit %s-Interpolation für DM-Strings; keys from admin/i18n/en.json)
src/server/hue-server.ts          → Fastify HTTP/HTTPS (trustProxy opt-in, bodyLimit 64KiB, forceCloseConnections)
src/server/routes/api-v1-routes.ts → Hue API v1 Endpoints
src/types/                        → config (HueEmulatorConfig.trustProxy, validateNetworkConfig), errors, hue-api, light, utils (sanitizeId + errText)
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

## Tests (461 unit + 57 standard + 1 integration = 519)

Runner: **vitest** (globals, pool: forks, coverage.include src/** für ehrliche Headline). Config: `vitest.config.ts`.

**WICHTIG:** .gitignore hat `*.js` — test/package.js und test/integration.js haben Ausnahmen!

API-Drift-Härtung: incoming Hue-API bodies und foreign-state values werden type-guarded.

## FORBIDDEN_CHARS

`sanitizeId()` in `types/utils.ts` (shared) — ersetzt `[^A-Za-z0-9-_]` durch `_`.
Importiert von `user-service.ts` und `main.ts`. Betrifft: Client-Usernames (von Alexa/Harmony), migrierte Legacy-User.

## Befehle

```bash
npm run build            # Production (esbuild via build-adapter)
npm run check            # tsc --noEmit (Type-Check ohne Build)
npm run test:ts          # Unit-Tests via vitest (474)
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
