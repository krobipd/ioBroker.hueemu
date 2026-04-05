# Changelog
## 1.1.2 (2026-04-05)

- Compact startup log (single info line with host, port, device count)
- Move server, SSDP, and device binding detail logs to debug level
- Remove redundant pairing and user creation log messages

## 1.1.1 (2026-04-05)

- Remove redundant scripts (`build:ts`, `watch:ts`, `prepare`, `pack`, `check:structure`, `clean:project`)
- Compress CLAUDE.md documentation (275 → 84 lines)

## 1.1.0 (2026-04-04)

- Remove legacy `createLight` mode — existing devices auto-migrated to admin configuration
- Remove LightService, definition module (~400 lines of legacy code)
- Simplify ApiHandler (always uses DeviceBindingService)
- Add `createLight` to obsolete state cleanup

## 1.0.26 (2026-04-04)

- Migrate test infrastructure to standard pattern (tsconfig.test.json, tests in test/)
- Unit tests (148) now run in CI via test:integration (previously only ran locally)
- Remove ts-node, source-map-support devDependencies

## 1.0.25 (2026-04-03)

- Modernize dev tooling: esbuild via build-adapter, @tsconfig/node20, rimraf, TypeScript ~5.9.3 pin
- Upgrade testing-action-check to v2.0.0
- Dependabot: monthly schedule, auto-merge skips major updates
- Branch protection: require check-and-lint status check

## 1.0.24 (2026-03-28)

- Fix on/off state conversion for string values ("false"/"0" now correctly treated as off)

## 1.0.23 (2026-03-27)

- Admin UI: merge About tab into Network tab (3 tabs → 2, donation as header section)
- Remove orphaned upnpPort i18n keys from all languages

## 1.0.22 (2026-03-27)

- Remove unused onObjectChange and onMessage handlers (code review)
- Sanitize external object IDs with FORBIDDEN_CHARS in legacy light creation
- Use adapter setTimeout/clearTimeout instead of native timers
- Add Windows and macOS to CI test matrix
- README: standard license format with full MIT text (W6009 fix)
- Split old changelog into CHANGELOG_OLD.md

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)
