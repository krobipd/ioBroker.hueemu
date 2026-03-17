# ioBroker.hueemu

![Version](https://img.shields.io/badge/version-1.0.6-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/license-MIT-green)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)
![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)
![Installations](https://iobroker.live/badges/hueemu-installed.svg)

![Logo](admin/hue-emu-logo.png)

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
| **On/Off** | `on` | LOM001 |
| **Dimmable** | `on`, `bri` | LWB010 |
| **Color Temperature** | `on`, `bri`, `ct` | LTW001 |
| **Color Light** | `on`, `bri`, `ct`, `hue`, `sat`, `xy` | LCT003 |

### Connecting with Alexa

1. Start the adapter
2. Alexa App → Devices → `+` → Philips Hue
3. The bridge is discovered automatically
4. "Alexa, turn on Living Room Light"

---

## Troubleshooting

### Bridge not found

- Ensure the UPnP port (1900) is not blocked by a firewall
- The **Host** IP must be the actual network IP, not `0.0.0.0`
- Check firewall rules on the ioBroker host

### Alexa finds no devices

- Activate pairing mode (50-second window)
- Ensure at least one device is configured
- Check adapter logs for errors

### State changes not working

- Verify state IDs in device configuration
- Check value ranges: `bri` 0–100 or 0–1, `ct` 153–500 (Mireds)

---

## Development

The adapter is written entirely in **TypeScript** with `strict` mode.

```bash
npm run build      # Build
npm test           # Tests
npm run lint       # Lint
npm run watch      # Watch mode
```

### Project Structure

```
src/
├── main.ts                    # Adapter main class
├── definition/                # ioBroker definitions
├── discovery/                 # UPnP/SSDP discovery
├── hue-api/                   # Hue API implementation
├── server/                    # HTTP server (Fastify)
└── types/                     # TypeScript types
test/                          # Tests
build/                         # Compiled JavaScript code
```

---

## Changelog

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

If this adapter is useful to you, consider supporting its development:

[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

---

## License

MIT License - see [LICENSE](LICENSE)

Copyright (c) 2020-2026 Christopher Holomek <holomekc.github@gmail.com>

---

*Developed with assistance from Claude.ai*
