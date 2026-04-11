# Older Changelog

## [1.1.1] - 2026-04-05

- Remove redundant scripts, compress documentation

## [1.1.0] - 2026-04-04

- Remove legacy `createLight` mode — existing devices are auto-migrated to admin configuration
- Remove LightService, definition module (~400 lines of legacy code)
- Simplify ApiHandler (always uses DeviceBindingService)
- Add `createLight` to obsolete state cleanup

## [1.0.26] - 2026-04-04

- Migrate test infrastructure to standard pattern (tsconfig.test.json, tests in test/)
- Unit tests (148) now run in CI via test:integration (previously only ran locally)
- Remove ts-node, source-map-support devDependencies

## [1.0.25] - 2026-04-03

- Modernize dev tooling: esbuild via build-adapter, @tsconfig/node20, rimraf, TypeScript ~5.9.3 pin
- Upgrade testing-action-check to v2.0.0
- Dependabot: monthly schedule, auto-merge skips major updates
- Branch protection: require check-and-lint status check

## [1.0.24] - 2026-03-28

- Fix on/off state conversion for string values ("false"/"0" now correctly treated as off)

## [1.0.23] - 2026-03-27

- Admin UI: merge About tab into Network tab (3 tabs → 2, donation as header section)
- Remove orphaned upnpPort i18n keys from all languages

## [1.0.22] - 2026-03-27

- Remove unused onObjectChange and onMessage handlers (code review)
- Sanitize external object IDs with FORBIDDEN_CHARS in legacy light creation
- Use adapter setTimeout/clearTimeout instead of native timers
- Add Windows and macOS to CI test matrix
- README: standard license format with full MIT text (W6009 fix)
- Split old changelog into CHANGELOG_OLD.md

## [1.0.21] - 2026-03-21

- Trim io-package.json news to max 7 entries (W1032 repochecker warning)

## [1.0.16] - 2026-03-19

- Fix floating promises (add void to all async calls)

## [1.0.15] - 2026-03-19

- Fix trailing comma in io-package.json (invalid JSON)
- Trim changelog to last 5 versions

## [1.0.9] - 2026-03-19

- Persist UDN/MAC to config for stable bridge identity across restarts
- Auto-generate MAC from UDN when not configured
- Add lowercase SSDP USN for Harmony Hub compatibility
- Log client IP on pairing, set linkbutton dynamically

## [1.0.8] - 2026-03-18

- Add groups action endpoint for Harmony Hub compatibility

## [1.0.7] - 2026-03-18

- Enable npm Trusted Publishing (OIDC), remove legacy npm-token

## [1.0.6] - 2026-03-17

- Resolve ioBroker repochecker errors and warnings
- Fix release-script before_commit config

## [1.0.5] - 2026-03-16

- Add responsive size attributes to jsonConfig (E6005/E7001 fixes)
- Fix io-package.json news versions (E2004)

## [1.0.3] - 2026-03-15

- Update dependencies, remove dead code
- Refactor documentation structure

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
