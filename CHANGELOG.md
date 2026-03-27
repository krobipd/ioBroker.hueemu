# Changelog
## **WORK IN PROGRESS**

## 1.0.23 (2026-03-27)

- Admin UI: merge About tab into Network tab (3 tabs → 2, donation as header section)
- Remove orphaned upnpPort i18n keys from all languages
- Update node-forge 1.3.3 → 1.4.0

## 1.0.22 (2026-03-27)

- Remove unused onObjectChange and onMessage handlers (code review)
- Sanitize external object IDs with FORBIDDEN_CHARS in legacy light creation
- Use adapter setTimeout/clearTimeout instead of native timers
- Add Windows and macOS to CI test matrix
- README: standard license format with full MIT text (W6009 fix)
- Split old changelog into CHANGELOG_OLD.md
- Remove unused toDefaultPort method

## 1.0.21 (2026-03-21)

- Fix: clean up obsolete states (e.g. info.configuredDevices) from previous versions on adapter start

## 1.0.20 (2026-03-19)

- Code: SSDP port hardcoded to 1900 (removed config fallback)

## 1.0.19 (2026-03-19)

- Admin UI: SSDP port field removed (fixed at 1900 — all UPnP clients require this port)

## 1.0.18 (2026-03-19)

- Logging: Bridge identity, Network and SSDP startup messages moved to debug level

## 1.0.17 (2026-03-19)

- Admin UI: host field changed to interface dropdown (IP selector); SSDP port 1900 clarified as fixed in README

## 1.0.16 (2026-03-19)

- Logging cleanup: remove redundant onReady debug log; legacy lights creation moved to debug level

## 1.0.15 (2026-03-19)

- Remove redundant info.configuredDevices datapoint and verbose device startup log

Older changes: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)
