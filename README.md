# ioBroker.hueemu

[![npm version](https://img.shields.io/npm/v/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Installations](https://iobroker.live/badges/hueemu-installed.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="https://raw.githubusercontent.com/krobipd/ioBroker.hueemu/main/admin/hue-emu-logo.png" width="100" />

Emulates a [Philips Hue](https://www.philips-hue.com) Bridge (v2, BSB002) so that ioBroker devices appear as Hue lights to clients that only support the Hue API.

---

## When to use this adapter

**Use it if you want to control ioBroker states from an older device or app that only speaks the Hue API.** Examples: Logitech Harmony Hub, Bosch Smart Home Controller, legacy Echo firmware, in-wall touch panels, abandoned dashboard apps, old control systems with a Hue plugin.

### Modern Alexa, Google Home or Apple Home — use the Matter adapter instead

Modern voice assistants all support Matter directly. Use the [ioBroker Matter adapter](https://github.com/ioBroker/ioBroker.matter) — it's the right tool for that. This adapter is only for clients that don't have a Matter option.

---

## Features

- **Hue API v1** — Bridge model BSB002 (Hue Bridge v2)
- **UPnP/SSDP Discovery** — Automatic detection by any Hue-compatible client
- **Direct state mapping** — Point to any ioBroker state, no bridge scripts
- **Light types** — On/Off, Dimmable, Color Temperature, RGB

---

## Requirements

- **Node.js >= 20**
- **ioBroker js-controller >= 7.0.7**
- **ioBroker Admin >= 7.7.22**

---

## Ports

| Port | Protocol | Purpose | Configurable |
|------|----------|---------|--------------|
| 8080 | TCP/HTTP | Hue Bridge API | Yes — clients are informed via SSDP |
| 1900 | UDP      | SSDP/UPnP Discovery | No — fixed by the UPnP standard |
| —    | TCP/HTTPS | Optional TLS (if configured) | Yes |

---

## Configuration

### Network Settings

| Option | Description | Default |
|--------|-------------|---------|
| **Host** | IP address of the bridge (must be a real network IP) | — |
| **HTTP Port** | Port for the Hue API | 8080 |
| **HTTPS Port** | Optional HTTPS port | — |
| **MAC Address** | Bridge MAC (auto-generated if empty) | — |

### Adding Devices

1. Open the **Device Configuration** tab
2. Click the `+` button
3. Enter a **Name** (e.g. "Living Room Light")
4. Select a **Light Type**
5. Map **States** via the object browser (`...`)

### Supported Light Types

| Type | States | Hue Model |
|------|--------|-----------|
| **On/Off** | `on` | LWB007 |
| **Dimmable** | `on`, `bri` | LWB010 |
| **Color Temperature** | `on`, `bri`, `ct` | LTW001 |
| **Color Light** | `on`, `bri`, `ct`, `hue`, `sat`, `xy` | LCT003 |

### Pairing

Before any client can connect, pairing must be activated:

1. ioBroker Objects → `hueemu.0` → set **`startPairing`** to `true`
2. Start the device search / pairing in your client app within **50 seconds**
3. After successful pairing a new entry appears under `hueemu.0.clients.*`

### Connecting with Alexa (older Echo without Matter)

> If you have a current Echo, use the [Matter adapter](https://github.com/ioBroker/ioBroker.matter) instead.

> **Tip:** If Alexa cannot find the bridge, try changing the HTTP port to **80** in the adapter settings — some Alexa firmware versions only discover bridges on port 80.

1. Activate pairing (see above)
2. Alexa App → Devices → `+` → Philips Hue
3. The bridge is discovered automatically

### Connecting with Logitech Harmony Hub

1. Activate pairing (see above)
2. In the Harmony setup software: Add Device → Lighting → Philips Hue → search for bridge
3. Confirm pairing within 50 seconds

---

## State Tree

```
hueemu.0.
├── startPairing         — Enable pairing mode for 50 seconds (button)
├── disableAuth          — Disable authentication (switch)
└── clients/             — Paired client devices
    └── {username}       — Client API key (created during pairing)
```

---

## Troubleshooting

### Upgrading from 0.x / legacy createLight mode

If you used the old `createLight` JSON state to define lights, your devices are **automatically migrated** on first start. The adapter reads your existing device objects, converts them to the new admin configuration format, and restarts once. No manual action required — your existing scripts and automations continue to work as before.

**Optional improvement:** The old system used internal adapter states as intermediaries, requiring separate scripts to control the actual devices. You can now open the adapter settings and change the state mappings to point **directly** to your device states (e.g. `hm-rpc.0.dimmer.LEVEL` instead of `hueemu.0.1.state.bri`).

### Bridge not found

- Ensure the UPnP port (1900) is not blocked by a firewall
- The **Host** IP must be the actual network IP, not `0.0.0.0`
- Check firewall rules on the ioBroker host

### Client finds no devices / pairing fails

- Set `startPairing` to `true` in ioBroker Objects → `hueemu.0` **before** starting the device search in your client — you have 50 seconds
- Ensure at least one device is configured
- Check adapter logs for errors

### State changes not working

- Verify state IDs in device configuration
- Check value ranges: `bri` 0–100 or 0–1, `ct` 153–500 (Mireds)

---

## Changelog
### 1.3.0 (2026-05-01)
- Cleanup wave aligned with parcelapp v0.3.0 + beszel v0.3.8
- Added `format` / `format:check` npm-scripts and explicit `prettier.config.mjs` (project style: spaces, double-quotes)
- Added `supportedMessages.stopInstance: true` so admin can soft-stop the instance over the message bus
- Migrated `repochecker-version-gate` workflow from `M1000_IOPackageJson.js` parsing to `sources-dist-stable.json` (covers every ioBroker dep, not just js-controller + admin)
- Cleaned `tsconfig.build.json` exclude (dropped a dead `src/test-helpers.ts` reference; the helper lives at `test/test-helpers.ts`)
- Auto-synced via release-mode: `js-controller >=7.0.7`, `admin >=7.7.22` (latest stable from `sources-dist-stable.json`)

### 1.2.9 (2026-04-28)
- Audit cleanup against the upstream `ioBroker.example/TypeScript` full standard:
  - Test setup migrated: tests now live next to source under `src/**/*.test.ts` (mirroring the modular sub-folders), shared mock factory moved to `test/test-helpers.ts`. Removed `tsconfig.test.json` + `build-test/`, added `test/mocharc.custom.json` + `test/mocha.setup.js` + `test/tsconfig.json` + `test/.eslintrc.json`
  - `@types/node` rolled back from `^25.6.0` to `^20.19.24` so type defs match `engines.node: ">=20"`
  - Dependabot now ignores major bumps for `@types/node`, `typescript`, `eslint`, `actions/checkout`, `actions/setup-node`
  - `nyc` config + `coverage` script added
  - `prettier.config.mjs` made explicit with project-style overrides
  - Orphan `.github/auto-merge.yml` removed (active workflow is `automerge-dependabot.yml` using `gh pr merge`)

### 1.2.8 (2026-04-26)
- Process-level `unhandledRejection` / `uncaughtException` handlers added as last-line-of-defence against fire-and-forget rejections.
- Stop shipping the `manual-review` release-script plugin — adapter-only consequence.
- Min js-controller correction: was `>=7.0.0`, restored to repochecker-recommended `>=6.0.11` (Source: `ioBroker.repochecker/lib/M1000_IOPackageJson.js`).
- `@types/iobroker` bumped to `^7.1.1`.

### 1.2.7 (2026-04-23)
- Separate test-build output (`build-test/`) from production `build/`, so `npm test` no longer risks leaving duplicated `build/src` + `build/test` trees in the published package.
- Declare `clients` meta-folder as an instance object so the parent exists before `clients.<username>` children are created dynamically by the user service.
- Wrap async `onReady` handler with `.catch()` as defense-in-depth — keeps the adapter from turning a future refactor error into an unhandled rejection → restart loop.

### 1.2.6 (2026-04-18)
- Harden request-body validation on all write endpoints (POST /api, PUT /lights/:id/state, PUT /groups/:id/action): reject arrays and wrong-typed `devicetype`, keep Hue-style error responses
- Harden numeric coercion in both directions on `bri`, `hue`, `sat`, `ct`, `xy`: reject `NaN`/`Infinity`, round fractional values, fall back to defaults on junk input
- Expand test coverage 146 → 226 (add `testApiRoutes`, `testApiHandler`, `testUserService`, plus edge-case cases for value conversion)

Older entries are in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization:** krobi

---

## Support

- [ioBroker Forum](https://forum.iobroker.net/)
- [GitHub Issues](https://github.com/krobipd/ioBroker.hueemu/issues)

### Support Development

This adapter is free and open source. If you find it useful, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge)](https://paypal.me/krobipd)

---

## License

MIT License

Copyright (c) 2020-2024 Christopher Holomek <holomekc.github@gmail.com>  
Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

*Developed with assistance from Claude.ai*
