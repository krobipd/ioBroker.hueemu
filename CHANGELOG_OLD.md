# Older Changelog

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
