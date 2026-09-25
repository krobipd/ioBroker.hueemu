# hueemu — a Philips Hue bridge for devices that only speak Hue

This adapter makes ioBroker look like a **Philips Hue Bridge** (a v2 bridge, model
BSB002) on your local network. Anything that can control Hue lights through the Hue
API — a Logitech Harmony hub, an older Echo, a wall panel, an abandoned dashboard app —
sees the lights you published and switches them. Clients that search the network via
SSDP (Alexa, Harmony) find the bridge by themselves; any other client is given its IP
address. Behind each of those "lights" sits an ioBroker state of your choosing.

It is the counterpart to a real bridge: instead of Philips hardware answering, your
ioBroker instance does — and the lights it offers can be anything the object tree
knows, from a Zigbee bulb to a KNX dimmer to a relay in a heating controller.

> **If your voice assistant supports Matter, use the [Matter adapter](https://github.com/ioBroker/ioBroker.matter) instead.**
> Current Alexa, Google Home and Apple Home devices all speak Matter, which is the
> better path in every respect. This adapter exists for clients that have no Matter
> option and will never get one.

## Requirements

- Node.js 22 or newer
- js-controller 7.2.2 or newer
- admin 8.0.11 or newer
- The client and the ioBroker host on the **same local network**

## Setting it up

### 1. Create the instance

Install the adapter and create one instance. The instance is created **stopped**:
choose the Host / IP address and the port (steps 2 and 3) first, then start it. It
listens on port 8080 unless you choose another one.

### 2. Host / IP address

Leave **Host / IP** on `0.0.0.0` ("listen on all interfaces"). The adapter then works
out the routable address of your ioBroker host and announces that one to clients.

Set a concrete address only if your host sits on **several networks** and the client
can reach it on just one of them.

### 3. Port

`8080` is the default and works with a Harmony hub.

**Alexa needs port 80, and current Echo devices also try HTTPS on 443.** For Alexa set
**Port** to `80` and **HTTPS Port** to `443`; the bridge answers HTTPS with its own
self-signed certificate. A port below 1024 needs the right to bind it — the ioBroker
installer grants that to Node.js on Linux; if the log says the port cannot be bound,
that right is missing.

**Trust X-Forwarded-\* headers** stays off unless the adapter sits behind a reverse
proxy you trust that strips client-supplied forwarding headers. It only changes which
client address the debug log shows.

### 4. Publish your lights

Open the **Devices** tab. Each card is one light the bridge offers.

**Automatically** — click **Search lights**. The adapter looks through your object
tree for things that behave like lights (a switch, a dimmer, a color-temperature
lamp, a color lamp) and shows what it found as a checklist. Tick the ones you want;
only those are added. Anything it found but could not map is counted in the message
afterwards, so nothing disappears silently.

**By hand** — click **Add light**, give it a name, pick a light type and point each
field at an ioBroker state with the object browser.

| Light type            | What the client sees                   |
| --------------------- | -------------------------------------- |
| **On/Off**            | on and off (shown as a dimmable light) |
| **Dimmable**          | on/off and brightness                  |
| **Color Temperature** | on/off, brightness, warm–cool white    |
| **Color**             | on/off, brightness, full color         |

Every light keeps its number for good: deleting or reordering lights changes nothing
for the others, so Alexa's routines keep pointing at the lamps they were set up with.
A light may point at a datapoint that no device confirms — one from `0_userdata`, a
script or a visualisation — and the bridge follows every change of it just the same.

### 5. Pair the client

A client may only connect after you open the pairing window — this is the equivalent
of pressing the button on a real bridge.

1. In ioBroker **Objects**, set `hueemu.0.startPairing` to `true`
2. Within **50 seconds**, start the device search in your client
3. A new entry under `hueemu.0.clients.` confirms the pairing

**Alexa (older Echo):** Alexa app → Devices → `+` → Philips Hue → **Philips Hue V1**.
Let only one Echo search if you have several. First-generation Echo devices no longer
support this path. Alexa handles at most 49 lights per bridge — with more, it finds
none. Use one emulated bridge per Alexa account: two instances announce their lights
under the same identifiers and Alexa mixes them up.

**Harmony:** MyHarmony desktop software → Devices → Add Device → Scan for devices (or
Lighting → Philips Hue).

## Value scales — what to check when a color looks wrong

ioBroker adapters store the same value in different units. A hue is kept in degrees
(0–360) by one adapter and in the Hue-native 0–65535 by another; a color temperature
is Kelvin here and mired there; a brightness is a percentage or a raw 0–254.

The adapter reads the unit and the value range from the state it binds and settles the
scale itself at every start — for lights the search found AND for lights you added by
hand, and it applies to reading and writing alike. Where a state says nothing about its
unit or its range — which happens, for instance, with the Zigbee adapter's color
temperature — the adapter falls back to reading the value itself, and writes it back
the same way it read it.

So if a light responds but shows the wrong color, the wrong white tone or jumps to
full brightness, open its card and set the scale by hand — "Automatic (from the
datapoint)" is the setting that lets the adapter decide:

- **Brightness / Saturation** — `Percent (0..100)` for a typical `level.dimmer`,
  `Normalized (0..1)`, `Raw (1..254 Hue)` for a source that already uses Hue's own
  range, or `Byte (0..255)`
- **Hue** — `Degrees (0..360)` for a normal ioBroker color state, `Native (no conversion)`
  for 0–65535
- **Color temperature** — `Kelvin` for a state holding values like 2700–6500,
  `Native (no conversion)` for mired (roughly 153–500), `Percent (0..100, 0 = cold)` for
  a state that runs from coldest to warmest in percent

## Lights that have no on/off state

Some dimmers offer only a brightness state and no separate switch — a HomeMatic dimmer
channel is the common example. Those work: the brightness carries on/off. A source
value of 0 reads as off, anything above it as on. Switching off writes 0; switching on
writes full brightness, because a source sitting at 0 no longer knows what it used to be.

## What ends up in the object tree

```
hueemu.0.
├── info/
│   ├── connection — whether the bridge is answering Hue clients
│   └── error      — why it is not (empty while everything works)
├── startPairing   — opens the pairing window for 50 seconds (button)
├── disableAuth    — accept every request without pairing (switch)
└── clients/       — one entry per paired client
    └── <name>     — the key that client uses
```

`info.connection` is the quick answer to "is it running at all?". A start can fail for
reasons the instance list does not show. An error from the system — the port already
taken, for example — then appears in `info.error` as it is; for a problem the adapter
diagnoses itself (no port set, no usable network address) `info.error` shows `Unknown`
and the log carries the explanation.

A paired client is removed by deleting its entry under `hueemu.0.clients` — its key
stops working at once.

`disableAuth` is a maintenance aid, not a setting to leave on: with it every device on
your network can control your lights without pairing. New clients are limited to 100
per hour in any case; a single log warning tells you when that limit was reached.

## Ports the adapter uses

| Port | Protocol | What for                       | Configurable                    |
| ---- | -------- | ------------------------------ | ------------------------------- |
| 8080 | TCP      | the Hue API itself (Alexa: 80) | yes — clients learn it via SSDP |
| 1900 | UDP      | discovery, so clients find you | no — fixed by the UPnP standard |
| —    | TCP      | optional HTTPS (Alexa: 443)    | yes, off unless you set a port  |

## Troubleshooting

**The client does not find the bridge.** Check that UDP port 1900 is not blocked
between client and ioBroker host, and that both are on the same network segment — a
guest network or a separate VLAN will not work without extra routing. On a host with
several network cards, set **Host / IP** to the concrete LAN address instead of
`0.0.0.0`. For Alexa, see port 80 and HTTPS 443 above.

**Pairing fails.** `startPairing` must be `true` **before** you start the search in the
client, and the window is only 50 seconds. A client that pairs by asking for a key
closes the window again — that is what a real bridge does too; a client that is
admitted while it looks up lights leaves it open until the 50 seconds are over.

**A light appears but does not react.** Check that the state you bound is actually
writable. A status state (a sensor mirroring what a device reports) can be read but not
written, so the light will show a value and ignore every command.

**A light shows the wrong color or brightness.** See "Value scales" above.

**Going back to a version below 1.18.0** is not supported: the older version no longer
finds the listen address under its new key and numbers the lights anew, so Alexa sees
different lamps.

**You come from the old `createLight` setup.** Your lights are converted automatically
on the first start and the adapter restarts once. Nothing to do by hand. Worth doing
afterwards: the old approach used adapter-internal states as go-betweens, which needed
a script to drive the real device. You can now point each light straight at the device
state and drop that script.

## Privacy

The adapter speaks only to devices on your own network; it has no cloud connection and
sends nothing to the internet on its own.

Error reporting via Sentry is active by default; what it sends and how to switch it off is described in the [Sentry section of the main README](../../README.md#sentry--error-reporting).
