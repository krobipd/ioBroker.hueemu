# Older Changes
## 1.2.3 (2026-04-11)
- Extract shared `sanitizeId` utility module (DRY)
- Add Hue API value range constants for readability
- Add pairing timeout constant
- Improve callback error handling in UserService
- Replace `as any` with type-safe casts in DeviceBindingService
- Enforce `no-floating-promises` as error
- Split monolithic test file into focused modules (146 tests)
- Fix duplicate io-package.json news entry

## 1.2.2 (2026-04-11)
- Remove redundant `actions/checkout@v6` from CI workflow (ioBroker testing actions handle checkout internally)
- Fix `readme` URL in io-package.json (master → main)

## 1.2.1 (2026-04-08)
- Restore standard integration tests (create-adapter compatible)
- Add FORBIDDEN_CHARS sanitization for all external object IDs
- Remove CHANGELOG.md (changelog in README + CHANGELOG_OLD.md)
- Remove dead code, clean up empty JSDoc stubs

## 1.2.0 (2026-04-06)
- Rename `user` folder to `clients` — clearer naming for paired endpoints (Alexa, Harmony, etc.)
- Automatic migration of existing paired clients on startup

Older entries have been moved to [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

---

## 1.1.4 (2026-04-05)
- Clean up obsolete `info.connection` state, remove empty parent folders after state cleanup

## 1.1.3 (2026-04-05)
- Remove unused `info.connection` state (no external connection to track)

## 1.1.2 (2026-04-05)
- Compact startup log, move detail logs to debug level

## 1.1.1 (2026-04-05)
- Remove redundant scripts, compress documentation

## 1.1.0 (2026-04-04)
- Remove legacy `createLight` mode — existing devices are auto-migrated to admin configuration
- Remove LightService, definition module (~400 lines of legacy code)
- Simplify ApiHandler (always uses DeviceBindingService)
- Add `createLight` to obsolete state cleanup

## 1.0.26 (2026-04-04)
- Migrate test infrastructure to standard pattern (tsconfig.test.json, tests in test/)
- Unit tests (148) now run in CI via test:integration

## 1.0.25 (2026-04-03)
- Modernize dev tooling: esbuild via build-adapter, @tsconfig/node20, rimraf, TypeScript ~5.9.3 pin
- Upgrade testing-action-check to v2.0.0
- Dependabot: monthly schedule, auto-merge skips major updates

## 1.0.24 (2026-03-28)
- Fix on/off state conversion for string values ("false"/"0" now correctly treated as off)

## 1.0.23 (2026-03-27)
- Admin UI: merge About tab into Network tab (3 tabs → 2, donation as header section)
- Remove orphaned upnpPort i18n keys from all languages

## 1.0.22 (2026-03-27)
- Remove unused onObjectChange and onMessage handlers
- Sanitize external object IDs with FORBIDDEN_CHARS
- Use adapter setTimeout/clearTimeout instead of native timers
- Add Windows and macOS to CI test matrix
- README: standard license format with full MIT text
- Split old changelog into CHANGELOG_OLD.md

## 1.0.21 (2026-03-21)
- Trim io-package.json news to max 7 entries (W1032)

## 1.0.16 (2026-03-19)
- Fix floating promises (add void to all async calls)

## 1.0.15 (2026-03-19)
- Fix trailing comma in io-package.json (invalid JSON)
- Trim changelog to last 5 versions

## 1.0.9 (2026-03-19)
- Persist UDN/MAC to config for stable bridge identity across restarts
- Auto-generate MAC from UDN when not configured
- Add lowercase SSDP USN for Harmony Hub compatibility
- Log client IP on pairing, set linkbutton dynamically

## 1.0.8 (2026-03-18)
- Add groups action endpoint for Harmony Hub compatibility

## 1.0.7 (2026-03-18)
- Enable npm Trusted Publishing (OIDC), remove legacy npm-token

## 1.0.6 (2026-03-17)
- Resolve ioBroker repochecker errors and warnings
- Fix release-script before_commit config

## 1.0.5 (2026-03-16)
- Add responsive size attributes to jsonConfig (E6005/E7001 fixes)
- Fix io-package.json news versions (E2004)

## 1.0.3 (2026-03-15)
- Update dependencies, remove dead code

## 1.0.2 (2026-03-15)
- Add Node.js 24 LTS support
- CI tests Node.js 20, 22 and 24
- Release workflow with correct permissions (contents: write)

## 1.0.1 (2026-03-15)
- Migrate to @iobroker/eslint-config
- Prettier code formatting
- Updated dependencies (adapter-core 3.3.2, fastify 5.8.2, typescript 5.8.3)

## 1.0.0 (2026-03-09)
- Major rewrite: replace hue-emu library with Fastify implementation
- Replace rxjs with async/await
- Modern TypeScript 5.6 codebase
- New JSON-Config Admin UI (replaces Materialize)
- Node.js 20+ and js-controller 7.0+ required

## 0.0.4
- Configuration of upnp port allowed

## 0.0.3
- Picked correct network interface if multiple are available

## 0.0.2
- Improve handling missing state keys

## 0.0.1
- Initial release by Christopher Holomek (@holomekc)
- Hue Bridge emulation, basic light control, Alexa/Google Home integration
- UPnP/SSDP discovery, uses hue-emu library and rxjs
