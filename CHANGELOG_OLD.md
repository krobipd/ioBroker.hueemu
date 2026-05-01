# Older Changes
## 1.2.8 (2026-04-26)
- Crash defense: process-level error handlers.
- Min `js-controller` restored to `>=6.0.11` (was incorrectly `>=7.0.0`).

## 1.2.7 (2026-04-23)
- Internal hardening. No user-facing changes.

## 1.2.6 (2026-04-18)
- API hardening: request-body validation + numeric coercion (bri/hue/sat/ct/xy).

## 1.2.5 (2026-04-17)
- Documentation: clearer scope (legacy Hue-only clients), fixed translations across 11 languages.

## 1.2.4 (2026-04-13)
- Internal refactor: dead-code removal + helper extraction.

## 1.2.3 (2026-04-11)
- Internal refactor: shared utilities + tests modularized.

## 1.2.2 (2026-04-11)
- Internal CI cleanup.

## 1.2.1 (2026-04-08)
- Restored standard integration tests; `FORBIDDEN_CHARS` sanitization for external object IDs.

## 1.2.0 (2026-04-06)
- Renamed `user` folder to `clients`. Existing pairings auto-migrated.

---

## 1.1.4 (2026-04-05)
- Removed obsolete `info.connection` state.

## 1.1.3 (2026-04-05)
- Removed unused `info.connection` state (no external connection to track).

## 1.1.2 (2026-04-05)
- Compact startup log, detail logs moved to debug level.

## 1.1.1 (2026-04-05)
- Internal cleanup.

## 1.1.0 (2026-04-04)
- Removed legacy `createLight` mode. Existing devices auto-migrated.

## 1.0.26 (2026-04-04)
- Internal test-infra migration.

## 1.0.25 (2026-04-03)
- Internal dev-tooling modernization.

## 1.0.24 (2026-03-28)
- Fix: on/off state conversion for string values (`"false"`/`"0"` now correctly off).

## 1.0.23 (2026-03-27)
- Admin UI: About tab merged into Network tab.

## 1.0.22 (2026-03-27)
- Code-review fixes: object-ID sanitization, adapter timers, cross-platform CI.

## 1.0.21 (2026-03-21)
- Trim io-package.json news to 7 entries (W1032).

## 1.0.16 (2026-03-19)
- Fix floating promises.

## 1.0.15 (2026-03-19)
- Fix trailing comma in io-package.json.

## 1.0.9 (2026-03-19)
- Persist UDN/MAC across restarts. Lowercase SSDP USN for Harmony Hub compatibility.

## 1.0.8 (2026-03-18)
- Added groups action endpoint for Harmony Hub compatibility.

## 1.0.7 (2026-03-18)
- npm Trusted Publishing (OIDC) enabled.

## 1.0.6 (2026-03-17)
- Repochecker fixes; release-script before_commit config corrected.

## 1.0.5 (2026-03-16)
- jsonConfig responsive sizing (E6005/E7001); io-package.json news versions (E2004).

## 1.0.3 (2026-03-15)
- Internal dependency update.

## 1.0.2 (2026-03-15)
- Node.js 24 LTS support; CI tests on Node 20, 22, 24.

## 1.0.1 (2026-03-15)
- Internal: migrated to @iobroker/eslint-config + Prettier.

## 1.0.0 (2026-03-09)
- Major rewrite: Fastify replaces hue-emu library, new JSON-Config Admin UI. Node.js 20+ and js-controller 7.0+ required.

## 0.0.4
- Configuration of upnp port allowed.

## 0.0.3
- Picks correct network interface when multiple available.

## 0.0.2
- Improved handling of missing state keys.

## 0.0.1
- Initial release by Christopher Holomek (@holomekc).
- Hue Bridge emulation, basic light control, UPnP/SSDP discovery.
