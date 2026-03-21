# ioBroker.hueemu

[![npm version](https://img.shields.io/npm/v/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)
![Installations](https://iobroker.live/badges/hueemu-installed.svg)
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

### 1.0.20 (2026-03-19)
- Code: SSDP port hardcoded to 1900 (removed config fallback)

### 1.0.19 (2026-03-19)
- Admin UI: SSDP port field removed (fixed at 1900 — all UPnP clients require this port)

### 1.0.21 (2026-03-21)
- Fix: clean up obsolete states from previous versions on adapter start

### 1.0.20 (2026-03-19)
- Code: SSDP port hardcoded to 1900 (removed config fallback)

### 1.0.19 (2026-03-19)
- Admin UI: SSDP port field removed (fixed at 1900)

### 1.0.18 (2026-03-19)
- Logging: Bridge identity, Network and SSDP startup messages moved to debug level

### 1.0.17 (2026-03-19)
- Admin UI: host field changed to interface dropdown (IP selector)

### 1.0.16 (2026-03-19)
- Logging cleanup: remove redundant onReady debug log; legacy lights creation moved to debug level

### 1.0.15 (2026-03-19)
- Remove redundant info.configuredDevices datapoint and verbose startup log

Older changelog: [CHANGELOG.md](CHANGELOG.md)

---

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization (2026):** krobi

---

## Support

- [ioBroker Forum](https://forum.iobroker.net/)
- [GitHub Issues](https://github.com/krobipd/ioBroker.hueemu/issues)

If this adapter is useful to you, consider supporting its development via the PayPal badge at the top of this page.

---

## License

MIT License - see [LICENSE](LICENSE)

Copyright (c) 2020-2024 Christopher Holomek <holomekc.github@gmail.com>
Copyright (c) 2026 krobi <krobi@power-dreams.com>

---

*Developed with assistance from Claude.ai*
