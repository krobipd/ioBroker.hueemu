# <img src="https://cdn.jsdelivr.net/gh/krobipd/ioBroker.hueemu@main/admin/hue-emu-logo.svg" width="48" align="top" /> ioBroker.hueemu

**Release:** [![npm version](https://img.shields.io/npm/v/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu) ![stable](https://iobroker.live/badges/hueemu-stable.svg) ![Installations](https://iobroker.live/badges/hueemu-installed.svg) [![npm downloads](https://img.shields.io/npm/dt/iobroker.hueemu)](https://www.npmjs.com/package/iobroker.hueemu)

**Build:** [![Test and Release](https://github.com/krobipd/ioBroker.hueemu/actions/workflows/test-and-release.yml/badge.svg)](https://github.com/krobipd/ioBroker.hueemu/actions/workflows/test-and-release.yml) ![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) [![License](https://img.shields.io/badge/license-MIT-green)](LICENSE) [![Sentry](https://img.shields.io/badge/error%20reporting-Sentry-362d59?logo=sentry&logoColor=white)](https://github.com/ioBroker/plugin-sentry#plugin-sentry)

**Support:** [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd) [![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

Emulates a [Philips Hue](https://www.philips-hue.com) Bridge (v2, BSB002) so that ioBroker devices appear as Hue lights to clients that only support the Hue API.

---

## When to use this adapter

**Use it if you want to control ioBroker states from an older device or app that only speaks the Hue API.** Examples: Logitech Harmony Hub, Bosch Smart Home Controller, legacy Echo firmware, in-wall touch panels, abandoned dashboard apps, old control systems with a Hue plugin.

### Modern Alexa, Google Home or Apple Home — use the Matter adapter instead

Modern voice assistants all support Matter directly. Use the [ioBroker Matter adapter](https://github.com/ioBroker/ioBroker.matter) — it's the right tool for that. This adapter is only for clients that don't have a Matter option.

---

## Features

- **Hue API v1** — Bridge model BSB002 (Hue Bridge v2)
- **UPnP/SSDP Discovery** — found automatically by clients that search via SSDP (Alexa, Harmony); any other client connects by the bridge's IP address
- **Direct state mapping** — Point to any ioBroker state, no bridge scripts
- **Device assistant** — scan ioBroker for mappable lights and add them automatically, or add and edit each light by hand
- **Light types** — On/Off, Dimmable, Color Temperature, Color
- **Per-device value scale** — detected from the source state where it is declared, and always adjustable by hand
- **Lights without a switch** — a dimmer that only offers a brightness state is driven by that state
- **Relative commands** — "a bit darker", "a bit warmer" and dimmer rockers adjust the current value
- **Persistent TLS certificate** — clients only trust the bridge once, restarts keep the same identity
- **Localized state names** — admin labels follow the ioBroker system language
- **Automatic migration** — legacy `createLight` setups are converted to the admin configuration on first start

---

## Sentry / Error reporting

**This adapter uses Sentry libraries to automatically report exceptions and code errors to the developers.** Reporting is active by default. It stays off when the ioBroker diagnostics setting is `none` (`diag` in the system configuration), when data reporting is disabled for this instance or its host (`disableDataReporting`), and on CI systems. A report contains the error with its stack trace and technical context such as versions and platform, plus an anonymous installation ID.

For details and how to disable it, see the [Sentry plugin documentation](https://github.com/ioBroker/plugin-sentry#plugin-sentry). Error reporting requires js-controller 3.0 or newer.

---

## Requirements

- **Node.js >= 22**
- **ioBroker js-controller >= 7.2.2**
- **ioBroker Admin >= 8.0.11**

> The adapter CANNOT be installed via GitHub: The adapter must be installed via the ioBroker repository (stable or latest).

---

## Ports

| Port | Protocol  | Purpose                                        | Configurable                        |
| ---- | --------- | ---------------------------------------------- | ----------------------------------- |
| 8080 | TCP/HTTP  | Hue Bridge API (Alexa needs 80)                | Yes — clients are informed via SSDP |
| 1900 | UDP       | SSDP/UPnP Discovery                            | No — fixed by the UPnP standard     |
| —    | TCP/HTTPS | Optional TLS, off unless set (Alexa tries 443) | Yes                                 |

---

## Configuration

### Network Settings

The instance is created stopped: choose the Host / IP and the port first, then start it.

| Option                           | Description                                                                                                                                                  | Default |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| **Host / IP Address**            | The IP the bridge binds to and announces to clients (Alexa, Harmony). Choose `0.0.0.0` to listen on all interfaces — the announced IP is auto-detected       | 0.0.0.0 |
| **Port**                         | HTTP port for the Hue API                                                                                                                                    | 8080    |
| **HTTPS Port**                   | Empty = no HTTPS. Current Echo devices try `443` first — see "Connecting with Alexa"                                                                         | —       |
| **MAC Address**                  | Bridge MAC (auto-generated if empty)                                                                                                                         | —       |
| **Trust X-Forwarded-\* headers** | Only behind a trusted reverse proxy that strips client-supplied forwarding headers; the forwarded address then shows in the debug log instead of the proxy's | off     |

### Adding Devices

Open the **Devices** tab. There are two ways to add lights:

**Manually** — click **Add light**, enter a name, choose a light type, and map the ioBroker states with the object browser.

**Automatically** — click **Search lights**. The adapter scans your objects for things that look like lights (on/off, dimmers, color-temperature and color lights) and shows the mappable ones as a checklist — tick the ones you want and only those are added. Whatever it finds but cannot map is counted in the result message, so nothing disappears without a word.

The assistant also fills in the value scale wherever the source state declares one: a hue that runs 0–360 is read as degrees, a brightness with `%` or a 0–100 range as percent. Where a source declares neither a unit nor a range, the scale field is left empty and the adapter's default applies — check it on the light's card if a color or brightness looks off, and set it by hand.

Each light shows as a card — use **Edit** to change its mapping or **Delete** to remove it.

### Lights Without an On/Off State

Some dimmers expose only a brightness state and no separate switch (a HomeMatic dimmer channel, for example). Those work: brightness carries on/off, so a source value of 0 reads as off and anything above as on. Switching off writes 0; switching on writes full brightness, because a source sitting at 0 no longer knows what it used to be.

### Supported Light Types

| Type                  | States                                | Hue Model |
| --------------------- | ------------------------------------- | --------- |
| **On/Off**            | `on` (clients see a dimmable light)   | LWB007    |
| **Dimmable**          | `on`, `bri`                           | LWB010    |
| **Color Temperature** | `on`, `bri`, `ct`                     | LTW001    |
| **Color Light**       | `on`, `bri`, `ct`, `hue`, `sat`, `xy` | LCT003    |

### Pairing

Before any client can connect, pairing must be activated:

1. ioBroker Objects → `hueemu.0` → set **`startPairing`** to `true`
2. Start the device search / pairing in your client app within **50 seconds**
3. After successful pairing a new entry appears under `hueemu.0.clients.*`

New clients are limited to 100 per hour across all pairing paths; a single warning tells you when that limit was hit. A client-supplied username longer than 64 characters is replaced by a generated one.

### Connecting with Alexa (older Echo without Matter)

> If you have a current Echo, use the [Matter adapter](https://github.com/ioBroker/ioBroker.matter) instead.

Alexa is strict about how it reaches a Hue bridge:

- Set the **Port** to `80` — current Echo devices only look for the bridge there.
- Set the **HTTPS Port** to `443` as well — current Echo firmware tries HTTPS first and reports the lights as unresponsive when nothing answers there. The bridge serves its own self-signed certificate.
- A port below 1024 needs the right to bind it; the ioBroker installer grants that to Node.js on Linux. If the log says the port cannot be bound, that right is missing.
- First-generation Echo devices no longer support the Hue bridge path.
- Alexa handles at most 49 lights per bridge — with more, it finds none.
- Use one emulated bridge per Alexa account: two instances announce lights under the same identifiers and Alexa mixes them up.

1. Activate pairing (see above)
2. Alexa App → Devices → `+` → Philips Hue → choose **Philips Hue V1**
3. If you have several Echo devices, let only one of them search
4. The bridge is discovered automatically

### Connecting with Logitech Harmony Hub

1. Activate pairing (see above)
2. In the MyHarmony desktop software: Devices → Add Device → Scan for devices (or Lighting → Philips Hue)
3. Confirm pairing within 50 seconds

---

## State Tree

```
hueemu.0.
├── info/
│   ├── connection       — Whether the bridge is answering Hue clients
│   └── error            — Why it is not answering (empty while it works)
├── startPairing         — Enable pairing mode for 50 seconds (button)
├── disableAuth          — Disable authentication (switch)
└── clients/             — Paired client devices
    └── {username}       — Client API key (created during pairing)
```

If `info.connection` stays `false` after a start, look at `info.error`: an error from the
system (a port that is already taken, for example) appears there as it is; for a problem
the adapter diagnoses itself (no port set, no usable address) it shows `Unknown` and the
log carries the explanation.

---

## Troubleshooting

### Upgrading from 0.x / legacy createLight mode

If you used the old `createLight` JSON state to define lights, your devices are **automatically migrated** on first start. The adapter reads your existing device objects, converts them to the new admin configuration format, and restarts once. No manual action required — your existing scripts and automations continue to work as before.

**Optional improvement:** The old system used internal adapter states as intermediaries, requiring separate scripts to control the actual devices. You can now open the adapter settings and change the state mappings to point **directly** to your device states (e.g. `hm-rpc.0.dimmer.LEVEL` instead of `hueemu.0.1.state.bri`).

### Bridge not found

- Ensure the UPnP port (1900) is not blocked by a firewall
- The address the adapter announces is written to the log at start ("Announcing … to clients"). On a host with Docker, a VM bridge or a VPN, set the **Host / IP** to the concrete LAN address if that pick is wrong
- Check firewall rules on the ioBroker host

### Client finds no devices / pairing fails

- Set `startPairing` to `true` in ioBroker Objects → `hueemu.0` **before** starting the device search in your client — you have 50 seconds
- Ensure at least one device is configured
- Check adapter logs for errors

### State changes not working

- Verify state IDs in device configuration
- The scale is normally determined from the datapoint itself (its unit and its range) and applies to reading AND writing. Pick it by hand only for a datapoint that declares neither — for brightness and saturation `Percent (0..100)`, `Normalized (0..1)`, `Raw (1..254 Hue)` or `Byte (0..255)`; for color temperature `Native (no conversion)` (mired), `Kelvin` or `Percent (0..100, 0 = cold)`.
- `ct` range is 153–500 (Mireds)

### Deleting a paired client

Delete its entry under `hueemu.0.clients` — the key stops working at once, no restart needed.

### Downgrading

Going back to a version below 1.18.0 is not supported: the older version no longer finds the listen address under its new key and numbers the lights anew, so Alexa sees different lamps.

---

## Changelog

<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**

- Fixed: With an HTTPS port the instance no longer restarts endlessly — the certificate key is now really stored encrypted, and a key that does not fit its certificate is replaced.
- Fixed: Clients that send no or another content type (phue, curl) can pair and switch again instead of getting error 901 from the bridge.
- Fixed: The number of a deleted light is never handed out again, not even the highest one — Alexa no longer mistakes a new lamp for the old one.
- New: Color temperature in percent (e.g. tradfri) and brightness from 0 to 255 are recognized and converted, and both can be chosen by hand on the light's card.
- Improved: Values are fitted to the target datapoint — clamped to its range, never written into a read-only state, and a text switch gets its own ON/OFF.
- Fixed: Switching off with a brightness in the same command now stays off for every light, and a group the bridge does not have no longer switches all lights.
- Fixed: Deleting a paired client in the admin now revokes its access at once instead of only at the next restart of the instance.
- Improved: The light search also finds relays and dimmers assigned to the function Light, and offers a lamp with a device and channel level only once.
- Fixed: openHAB's Hue binding can read the bridge again (time stamps in the bridge's format), and a color set by hue and saturation is shown as such in apps.

### 1.18.0 (2026-09-15) — stable

- Changed: The listen address and port are now stored under the standard keys the admin's port-conflict check reads — another adapter set to the bridge's port is warned before it collides.
- Improved: Your configured Host / IP address survives the update unchanged — nothing to re-enter, and the bridge keeps listening where it did before.
- Fixed: Every light now keeps its number for good — deleting or reordering a light no longer shifts the others, so Alexa keeps switching the lamp it was set up with (numbered once, one restart).
- Fixed: A light whose datapoint is written by a script, vis or 0_userdata now follows every change — the bridge used to ignore values no device had confirmed.
- Fixed: A dimmer without an on/off state is no longer offered and stored again on every "Search lights" run, and a light named by a translated object name is offered under that name instead of its id.
- Fixed: Two lights bound to the same datapoint get two separate cards — deleting the second one used to remove the first.
- Fixed: A client that pairs while the bridge is still loading its client list no longer risks being refused until the next restart.
- Fixed: A light whose datapoint was deleted now reports itself unreachable with default values instead of serving the last value it had seen.
- Changed: A state attribute no Hue light has is answered with the bridge's own error 6 instead of a success — for single lights and groups alike.

### 1.17.1 (2026-09-07)

- Improved: The switch that turns off authentication now warns what it really does — every client on the network is then served without a key and can pair itself.

### 1.17.0 (2026-09-06)

- Fixed: Brightness and saturation left on "Auto" are now written in the unit the datapoint really uses — a percent dimmer no longer receives Hue values like 127 or 254.
- Fixed: The scale of a light added by hand is now determined from the datapoint as well, exactly like a light found by the search.
- Fixed: A pairing that could not be stored is no longer reported as successful — the client retries instead of losing access at the next restart.
- Fixed: A client key is now checked exactly as it was issued; a key that merely resembles a paired one is rejected.
- New: The instance now shows in the object tree whether the bridge is answering, and why not when it is not.
- Fixed: On a host with Docker or a VPN, the automatically announced address is now the real network address instead of a virtual one.
- Fixed: A light whose configured datapoint does not exist is reported as unreachable instead of pretending to work.
- Fixed: Edit and delete in the devices tab always act on the light you clicked, even when the list changed in the meantime.
- Improved: The first start after this update completes the scales of lights added earlier — if it finds anything to complete, the instance restarts once.

### 1.16.0 (2026-09-03)

- Fixed: If an action in the devices tab fails, you now get a message saying what went wrong instead of a dialog that never finishes.

### 1.15.2 (2026-09-03)

- Fixed: When a very old setup is upgraded, its already paired clients now get their proper name and explanation right away instead of after the next restart.

[Older changelogs can be found there](CHANGELOG_OLD.md)

## Credits

This adapter would not exist without [Christopher Holomek](https://github.com/holomekc), who built the original Hue bridge emulator on GitHub back in 2020. The code has since been rewritten from the ground up — but the idea, and the proof that it works, are his.

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

Copyright (c) 2020-2021 Christopher Holomek <holomekc.github@gmail.com>  
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

_Developed with assistance from Claude.ai_
