# Changelog
## 1.0.15 (2026-03-19)

- Remove redundant info.configuredDevices datapoint and verbose device startup log

## 1.0.14 (2026-03-19)

- Fix: disable pairing after successful user registration (prevents repeated pairing requests being logged as a loop)

## 1.0.13 (2026-03-19)

- Fix: on/off lights now reported as Dimmable/LWB007 (matching ha-bridge behavior) to prevent Harmony Hub from showing color controls
- Fix: remove capabilities field from all light responses (ha-bridge compatibility)

## 1.0.12 (2026-03-19)

- Fix logging: move light command details from info to debug level

## 1.0.11 (2026-03-19)

- Improve logging: pairing start/stop messages, bridge identity (bridgeId/MAC/IP) at startup, info-level light control logs with device name and values, auth state changes

## 1.0.10 (2026-03-19)

- Fix: on/off lights no longer expose dimming and color capabilities to Harmony Hub (type-specific capabilities per light type)

## 1.0.9 (2026-03-19)

- Fix: persist generated UDN and MAC to adapter config so bridge identity stays stable across restarts
- Fix: SSDP now registers both `Basic:1` and `basic:1` USN variants for Harmony Hub compatibility
- Fix: empty serialNumber in description.xml when no MAC configured
- Fix: log client IP in request log for easier debugging
- Fix: set linkbutton dynamically based on pairing state

## 1.0.8 (2026-03-18)

- Fix: add PUT /api/:username/groups/:id/action endpoint for Logitech Harmony Hub compatibility

## 1.0.7 (2026-03-18)

- Code cleanup: remove commented-out import, dead server getters
- Fix unused parameter naming (_req/_username) in api-handler
- DRY: collapse 6 identical empty collection routes into a loop
- Remove Development/Project Structure from README (not ioBroker standard)

## 1.0.6 (2026-03-17)

- Migrate to @alcalzone/release-script for automated releases
- Enable npm Trusted Publishing (OIDC), remove legacy npm token
- Translate README to English, remove direct install instructions

## [1.0.2] - 2026-03-15

### Added

- Node.js 24 LTS Support
- CI testet jetzt Node.js 20, 22 und 24

### Changed

- GitHub Actions nutzen Node.js 24
- Release-Workflow mit korrekten Berechtigungen (`contents: write`)

---

## [1.0.1] - 2026-03-15

### Changed

- Aktualisierte Abhängigkeiten auf aktuelle Versionen (März 2026)
- Migriert zu @iobroker/eslint-config für einheitliche Code-Standards
- Code-Formatierung mit Prettier

### Dependencies

| Paket | Alt | Neu |
|-------|-----|-----|
| @iobroker/adapter-core | 3.2.2 | 3.3.2 |
| @iobroker/testing | 5.0.0 | 5.2.2 |
| fastify | 4.26.0 | 5.8.2 |
| typescript | 5.6.3 | 5.8.3 |
| mocha | 7.2.0 | 11.1.0 |
| eslint | 9.12.0 | 9.25.1 |

### Added

- @iobroker/eslint-config 2.2.0
- @iobroker/build-tools 3.0.1
- GitHub Actions für CI/CD
- Automatische Versionierung (scripts/version.js)

### Removed

- nyc, proxyquire, rimraf (nicht benötigt)
- Alte ESLint-Konfiguration

---

## [1.0.0] - 2026-03-09

### Major Rewrite

Komplette Modernisierung des Adapters durch krobi & AI Assistant.

### Changed

- Ersetzt `hue-emu` Library durch eigene Fastify-Implementation
- Ersetzt `rxjs` durch async/await
- Moderne TypeScript 5.6 Codebasis
- Neue JSON-Config Admin UI (ersetzt Materialize)
- Node.js 20+ erforderlich
- ioBroker js-controller 7.0+ erforderlich

### Added

- Fastify HTTP Server
- node-ssdp für UPnP Discovery
- Manuelle Gerätekonfiguration via Admin UI
- Import/Export für Gerätekonfiguration
- Unterstützung für: On/Off, Dimmbar, Farbtemperatur, RGB Lampen

### Removed

- `hue-emu` Dependency
- `rxjs` Dependency
- Alte Materialize Admin UI

---

## [0.0.4]

### Changed
- Configuration of upnp port allowed

## [0.0.3]

### Changed
- Picked correct network interface if multiple are available

## [0.0.2]

### Changed
- Improve handling missing state keys

## [0.0.1]

### Initial Release

Initial implementation by Christopher Holomek ([@holomekc](https://github.com/holomekc))

- Hue Bridge emulation
- Basic light control (on/off, brightness, color)
- Alexa/Google Home integration via Hue protocol
- UPnP/SSDP discovery
- Uses `hue-emu` library and `rxjs`

---

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc)) - 2020-2024

**Modernization:** krobi & AI Assistant - 2026
