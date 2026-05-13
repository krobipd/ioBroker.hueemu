# Older Changes
## 1.4.0 (2026-05-07)
- State names are localized in 11 languages following the ioBroker system language.
- Existing installs are migrated automatically — names are backfilled on first start, nothing to do.

## 1.3.3 (2026-05-01)
- Internal cleanup. No user-facing changes.

## 1.3.2 (2026-05-01)
- Documentation polish across all languages.

## 1.3.1 (2026-05-01)
- Documentation polish across all languages.

## 1.3.0 (2026-05-01)
- Adapter can now be stopped cleanly via admin's stop-instance message.

## 1.2.9 (2026-04-28)
- Internal cleanup. No user-facing changes.

## 1.2.8 (2026-04-26)
- Crash defense: process-level error handlers catch unexpected errors and restart cleanly instead of leaving the adapter half-broken.

## 1.2.7 (2026-04-23)
- Internal hardening. No user-facing changes.

## 1.2.6 (2026-04-18)
- API hardening: incoming light commands are now validated and out-of-range values are clamped instead of crashing the request.

## 1.2.5 (2026-04-17)
- Documentation: clearer scope (legacy Hue-only clients) and corrected translations.

## 1.2.4 (2026-04-13)
- Internal cleanup. No user-facing changes.

## 1.2.3 (2026-04-11)
- Internal cleanup. No user-facing changes.

## 1.2.2 (2026-04-11)
- Internal cleanup. No user-facing changes.

## 1.2.1 (2026-04-08)
- Client usernames are now sanitized so unusual characters can't break the bridge.

## 1.2.0 (2026-04-06)
- Renamed `user` folder to `clients`. Existing pairings are migrated automatically.

## 1.1.4 (2026-04-05)
- Removed obsolete `info.connection` state.

## 1.1.3 (2026-04-05)
- Internal cleanup. No user-facing changes.

## 1.1.2 (2026-04-05)
- Startup log is now compact; details moved to the debug log level.

## 1.1.1 (2026-04-05)
- Internal cleanup. No user-facing changes.

## 1.1.0 (2026-04-04)
- Removed legacy `createLight` mode. Existing devices are migrated automatically.

## 1.0.26 (2026-04-04)
- Internal cleanup. No user-facing changes.

## 1.0.25 (2026-04-03)
- Internal cleanup. No user-facing changes.

## 1.0.24 (2026-03-28)
- Fix: a stored string value of `"false"` or `"0"` on the on/off state now correctly turns the light off.

## 1.0.23 (2026-03-27)
- Admin UI: About tab merged into Network tab.

## 1.0.22 (2026-03-27)
- Internal cleanup. No user-facing changes.

## 1.0.21 (2026-03-21)
- Internal cleanup. No user-facing changes.

## 1.0.16 (2026-03-19)
- Internal cleanup. No user-facing changes.

## 1.0.15 (2026-03-19)
- Internal cleanup. No user-facing changes.

## 1.0.9 (2026-03-19)
- Bridge identity (UDN/MAC) is now persisted, so clients don't re-discover the bridge as new after every restart. Lowercase SSDP entry added for Logitech Harmony Hub compatibility.

## 1.0.8 (2026-03-18)
- Added the groups action endpoint so Logitech Harmony Hub can address Hue groups.

## 1.0.7 (2026-03-18)
- Internal cleanup. No user-facing changes.

## 1.0.6 (2026-03-17)
- Internal cleanup. No user-facing changes.

## 1.0.5 (2026-03-16)
- Internal cleanup. No user-facing changes.

## 1.0.3 (2026-03-15)
- Internal cleanup. No user-facing changes.

## 1.0.2 (2026-03-15)
- Node.js 24 is now supported.

## 1.0.1 (2026-03-15)
- Internal cleanup. No user-facing changes.

## 1.0.0 (2026-03-09)
- Major rewrite: new HTTP server, new admin UI. Requires a current ioBroker installation.

## 0.0.4
- UPnP port is now configurable.

## 0.0.3
- Picks the correct network interface when multiple are available.

## 0.0.2
- Improved handling of missing state keys.

## 0.0.1
- Initial release by Christopher Holomek.
- Hue Bridge emulation, basic light control, UPnP/SSDP discovery.
