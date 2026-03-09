# Changelog

## [1.0.0] - 2026-03-09

### Major Rewrite

Komplette Modernisierung des Adapters.

### Changed

- Ersetzt `hue-emu` Library durch eigene Fastify-Implementation
- Ersetzt `rxjs` durch async/await
- Moderne TypeScript 5.6 Codebasis
- Neue JSON-Config Admin UI (ersetzt Materialize)
- Node.js 18+ erforderlich
- ioBroker js-controller 5.0+ erforderlich

### Added

- Fastify HTTP Server
- node-ssdp für UPnP Discovery
- Manuelle Gerätekonfiguration via Admin UI
- Import/Export für Gerätekonfiguration
- Unterstützung für: On/Off, Dimmbar, Farbtemperatur, RGB Lampen

### Removed

- `hue-emu` Dependency
- `rxjs` Dependency
- Auto-Discovery (vereinfacht auf manuelle Konfiguration)
- Alte Materialize Admin UI

---

## [0.0.4] - 2024

- Configuration of upnp port allowed

## [0.0.3] - 2024

- Picked correct network interface if multiple are available

## [0.0.2] - 2024

- Improve handling missing state keys

## [0.0.1] - 2020

- Initial release by Christopher Holomek
