# CLAUDE.md — ioBroker.hueemu

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Hue Emulator** — Emuliert Philips Hue Bridge (v2, BSB002) für Alexa, Google Home, Harmony Hub.

- **Version:** 1.2.0 (April 2026)
- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **npm:** https://www.npmjs.com/package/iobroker.hueemu
- **Repository PR:** ioBroker/ioBroker.repositories#5634
- **Original Author:** Christopher Holomek (@holomekc) — Fork, modernisiert 2026
- **Runtime-Deps:** `@iobroker/adapter-core`, `fastify`, `node-ssdp`, `node-forge`, `uuid`

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

## Tests (193)

```
test/testMain.ts         → HueApiError (13), DescriptionXML (8), ConfigService (18),
                           DeviceBindingService (109), Error handler + Light types (8)
test/testPackageFiles.ts → @iobroker/testing (57)
```

Nicht getestet (bewusst): UserService (Callback-API), ApiHandler (Orchestrator), SSDP (Netzwerk).

## Versionshistorie

| Version | Highlights |
|---------|------------|
| 1.2.0 | Rename user→clients (Endgeräte), Auto-Migration, info-Ordner Cleanup |
| 1.1.4 | Obsolete info.connection Cleanup + leere Eltern-Ordner löschen |
| 1.1.3 | Ungenutzten info.connection setState entfernt |
| 1.1.2 | Kompakter Startup-Log, Detail-Logs auf debug |
| 1.1.1 | Redundante Scripts entfernt, Doku komprimiert |
| 1.1.0 | Legacy createLight entfernt, Auto-Migration, ~400 Zeilen Legacy-Code weg |
| 1.0.26 | Test-Infrastruktur Standard (tsconfig.test.json) |
| 1.0.25 | Dev-Tooling modernisiert (esbuild, TS 5.9 Pin) |
| 1.0.24 | Fix Boolean("false") Bug in on/off |
| 1.0.22 | Code-Review mcm1957: FORBIDDEN_CHARS, this.setTimeout, CI cross-platform |
| 1.0.9 | Stabile Bridge-Identität (UDN/MAC persistieren) |
| 1.0.0 | Major Rewrite: Fastify, moderne Admin UI |

## Befehle

```bash
npm run build        # Production (esbuild)
npm run build:test   # Test build (tsc)
npm test             # Build + mocha
npm run lint         # ESLint + Prettier
```
