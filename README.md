# ioBroker.hueemu

[![npm version](https://img.shields.io/npm/v/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Installations](https://iobroker.live/badges/hueemu-installed.svg)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="https://raw.githubusercontent.com/krobipd/ioBroker.hueemu/master/admin/hue-emu-logo.png" width="100" />

Emulates a Philips Hue Bridge (v2, BSB002) so that ioBroker devices can be controlled via Alexa, Google Home, and other Hue-compatible smart home systems.

---

## Features

- **Hue Bridge Emulation** — Full Hue API v1 compatibility
- **UPnP/SSDP Discovery** — Automatic detection by smart home systems
- **Modern Admin UI** — JSON-Config for easy device configuration
- **Flexible Device Types** — On/Off, Dimmable, Color Temperature, RGB lights

---

## Requirements

- **Node.js >= 20**
- **ioBroker js-controller >= 7.0.0**
- **ioBroker Admin >= 7.6.20**

---

## Ports

| Port | Protocol | Purpose | Configurable |
|------|----------|---------|--------------|
| 8080 | TCP/HTTP | Hue Bridge API | Yes — clients are informed via SSDP |
| 1900 | UDP      | SSDP/UPnP Discovery | No — fixed (all UPnP clients including Harmony, Alexa, Google Home scan exactly this port) |
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

Before any client (Alexa, Google Home, Harmony Hub, etc.) can connect, pairing must be activated:

1. ioBroker Objects → `hueemu.0` → set **`startPairing`** to `true`
2. Start the device search / pairing in your client app within **50 seconds**
3. After successful pairing a new entry appears under `hueemu.0.users.*`

### Connecting with Alexa

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
└── user/                — Authenticated clients
    └── {username}       — Client API key (created during pairing)
```

---

## Troubleshooting

### Upgrading from 0.x / legacy createLight mode

If you used the old `createLight` JSON state to define lights, your devices are **automatically migrated** on first start. The adapter reads your existing device objects, converts them to the new admin configuration format, and restarts once. No manual action required — your existing scripts and automations continue to work as before.

**Optional improvement:** The old system used internal adapter states as intermediaries, requiring separate scripts to control the actual devices. You can now open the adapter settings and change the state mappings to point **directly** to your device states (e.g. `hm-rpc.0.dimmer.LEVEL` instead of `hueemu.0.1.state.bri`). This eliminates the need for bridge scripts entirely.

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

### 1.1.0 (2026-04-04)
- Remove legacy `createLight` mode — existing devices are auto-migrated to admin configuration
- Remove ~400 lines of legacy code (LightService, definition module)

### 1.0.26 (2026-04-04)
- Migrate test infrastructure to standard pattern (tests now run in CI)

### 1.0.25 (2026-04-03)
- Modernize dev tooling (esbuild, TypeScript 5.9 pin, testing-action-check v2)

### 1.0.24 (2026-03-28)
- Fix on/off state conversion for string values ("false"/"0" now correctly treated as off)

### 1.0.23 (2026-03-27)
- Admin UI: merge About tab into Network tab (3 → 2 tabs)

### 1.0.22 (2026-03-27)
- Code review fixes: remove unused handlers, sanitize object IDs, use adapter timers, test on all platforms

### 1.0.21 (2026-03-21)
- Fix: clean up obsolete states from previous versions on adapter start

Older changelog: [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

---

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization (2026):** krobi

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
