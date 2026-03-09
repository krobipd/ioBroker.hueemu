# Changelog

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
