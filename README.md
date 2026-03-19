# ioBroker.hueemu

[![npm version](https://img.shields.io/npm/v/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Installations](https://iobroker.live/badges/hueemu-installed.svg)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

![Logo](https://raw.githubusercontent.com/krobipd/ioBroker.hueemu/master/admin/hue-emu-logo.png)

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

## Configuration

### Network Settings

| Option | Description | Default |
|--------|-------------|---------|
| **Host** | IP address of the bridge (must be a real network IP) | — |
| **HTTP Port** | Port for the Hue API | 8080 |
| **UPnP Port** | SSDP discovery port | 1900 |
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

## Troubleshooting

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

### 1.0.13 (2026-03-19)
- Fix: on/off lights now reported as Dimmable/LWB007 to prevent Harmony Hub showing color controls

### 1.0.12 (2026-03-19)
- Fix logging: light command details moved from info to debug level

### 1.0.11 (2026-03-19)
- Improve logging: pairing start/stop, bridge identity at startup, light control details

### 1.0.9 (2026-03-19)
- Fix: stable bridge identity across restarts (persist UDN/MAC)
- Fix: SSDP discovery for Harmony Hub (case-insensitive USN)
- Fix: empty serialNumber in description.xml

### 1.0.8 (2026-03-18)
- Fix: Logitech Harmony Hub compatibility — groups action endpoint

### 1.0.7 (2026-03-18)
- Code cleanup: remove dead code, fix unused params, DRY empty collection routes

### 1.0.6 (2026-03-17)
- Migrate to @alcalzone/release-script, enable npm Trusted Publishing, translate README to English

### 1.0.5 (2026-03-16)
- ioBroker repository compliance: copyright, LICENSE, responsive Admin UI, remove redundant devDependencies

### 1.0.4 (2026-03-15)
- Updated dependencies (uuid 13, sinon 21), removed dead code

### 1.0.3 (2026-03-15)
- Code cleanup: removed unused dependencies and dead code

### 1.0.0 (2026-03-09)
- Major rewrite: Fastify server, modern Admin UI, requires js-controller 7+

Older changelog: [CHANGELOG.md](CHANGELOG.md)

---

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization (2026):** krobi

---

## Support

If this adapter is useful to you, consider supporting its development via the PayPal badge at the top of this page.

---

## License

MIT License - see [LICENSE](LICENSE)

Copyright (c) 2020-2024 Christopher Holomek <holomekc.github@gmail.com>
Copyright (c) 2026 krobi <krobi@power-dreams.com>

---

*Developed with assistance from Claude.ai*
