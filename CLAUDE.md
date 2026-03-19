# CLAUDE.md - ioBroker Hue Emulator Adapter

**Aktuelle Version:** 1.0.13 (März 2026)

> Allgemeines ioBroker-Wissen: siehe `../CLAUDE.md`

## Projektübersicht

Der **ioBroker Hue Emulator** emuliert eine Philips Hue Bridge (v2, BSB002), damit ioBroker-Geräte über Alexa, Google Home und andere Hue-kompatible Systeme gesteuert werden können.

## Spezifische Abhängigkeiten

| Package | Version | Beschreibung |
|---------|---------|--------------|
| @iobroker/adapter-core | 3.3.2 | ioBroker Adapter-Basisklasse |
| fastify | 5.8.2 | HTTP/HTTPS Server |
| node-ssdp | 4.0.1 | UPnP/SSDP Discovery |
| node-forge | 1.3.3 | TLS-Zertifikatsgenerierung |
| uuid | 13.x | UUID Generierung |

## Architektur

```
src/
├── main.ts                    # Adapter-Hauptklasse (HueEmu)
├── main.test.ts               # Unit-Tests
├── definition/                # ioBroker-Definitionen
│   ├── functions.ts           # Funktions-Enums
│   ├── roles.ts               # State-Rollen
│   └── hue-emu-definition.ts  # Definition-Klasse
├── discovery/                 # UPnP/SSDP Discovery
│   ├── index.ts
│   ├── description-xml.ts     # UPnP XML Generator
│   └── ssdp-server.ts         # SSDP Server
├── hue-api/                   # Hue API Implementation
│   ├── index.ts
│   ├── api-handler.ts         # API Orchestrator
│   ├── config-service.ts      # Bridge-Konfiguration
│   ├── device-binding-service.ts  # Admin-konfigurierte Geräte
│   ├── light-service.ts       # Legacy Light Service
│   └── user-service.ts        # Benutzer-/Auth-Verwaltung
├── server/                    # HTTP Server
│   ├── index.ts
│   ├── hue-server.ts          # Fastify Server
│   ├── middleware/
│   │   └── error-handler.ts   # Hue Error Formatting
│   └── routes/
│       ├── api-v1-routes.ts   # Hue API v1 Endpoints
│       └── description-route.ts  # UPnP XML Route
└── types/                     # TypeScript Typen
    ├── index.ts
    ├── config.ts              # Konfigurationstypen
    ├── errors.ts              # HueApiError Klasse
    ├── hue-api.ts             # API Request/Response Typen
    └── light.ts               # Light Objekt Typen
```

## Hauptkomponenten

### HueEmu Adapter (`src/main.ts`)
- Lifecycle: `onReady()`, `onUnload()`, `onStateChange()`, `onObjectChange()`
- Verwaltet: HueServer, SsdpServer, ApiHandler
- Pairing-Modus mit 50s Timeout
- TLS-Zertifikatsgenerierung

### ApiHandler (`src/hue-api/api-handler.ts`)
Orchestriert alle API-Services:
- `UserService` → Benutzer-Authentifizierung
- `ConfigService` → Bridge-Konfiguration
- `DeviceBindingService` → Admin-konfigurierte Geräte (primär)
- `LightService` → Legacy-Modus

### DeviceBindingService (`src/hue-api/device-binding-service.ts`)
Mappt Admin-konfigurierte Geräte auf ioBroker States:
```typescript
interface DeviceConfig {
  name: string;
  lightType: 'onoff' | 'dimmable' | 'ct' | 'color';
  onState?: string;   // State-ID für on/off
  briState?: string;  // Helligkeit
  ctState?: string;   // Farbtemperatur
  hueState?: string;  // Hue
  satState?: string;  // Sättigung
  xyState?: string;   // CIE xy Koordinaten
}
```

## Light-Typen

| Typ | States (ioBroker) | Model ID | Hue Type (gemeldet) |
|-----|-------------------|----------|---------------------|
| onoff | on | LWB007 | Dimmable light |
| dimmable | on, bri | LWB010 | Dimmable light |
| ct | on, bri, ct | LTW001 | Color temperature light |
| color | on, bri, hue, sat, ct, xy | LCT003 | Extended color light |

**Hinweis:** `onoff` wird bewusst als `LWB007 / Dimmable light` an Harmony gemeldet (wie ha-bridge), weil Harmony `"On/Off light" / LOM001` nicht kennt und auf volle Farb-Controls zurückfällt. Die `capabilities`-Feld wird aus der Lichtantwort weggelassen (ha-bridge-kompatibel).

### Wertekonvertierung
- **bri**: 0-100 oder 0-1 → 1-254
- **sat**: 0-100 → 0-254
- **hue**: beliebig → 0-65535
- **ct**: 153-500 (Mireds)
- **xy**: Array [x,y] oder String "x,y"

## Hue API Endpoints

```
POST /api                                  → createUser (Pairing)
GET  /api/:username                        → getFullState
GET  /api/:username/config                 → getConfig
GET  /api/:username/lights                 → getAllLights
GET  /api/:username/lights/:id             → getLightById
PUT  /api/:username/lights/:id/state       → setLightState
PUT  /api/:username/groups/:id/action      → setGroupAction (wendet State auf alle Lights an)
GET  /api/:username/{groups,schedules,...} → leere Collections (groups, schedules, scenes, sensors, rules, resourcelinks)
GET  /description.xml                      → UPnP Device Description
GET  /health                               → Health Check
```

## Logitech Harmony Hub Kompatibilität

Harmony nutzt **ausschließlich Hue API v1**. Relevante Endpoints:
- `POST /api/` — Pairing (`devicetype: "Harmony Hub"`) via **MyHarmony Desktop + USB**, nicht Mobile App
- `GET /api/:username/lights` + `/groups` + `/scenes` + `/config` — Discovery
- `PUT /api/:username/lights/:id/state` — Einzelgerät steuern
- `PUT /api/:username/groups/:id/action` — Alle Geräte auf einmal steuern (Gruppe 0 = alle)

`setGroupAction` in `ApiHandler`: wendet State parallel auf alle konfigurierten Lights an, antwortet mit `/groups/:id/action/:key` Adressen.

## Discovery (SSDP)

- Advertises als `urn:schemas-upnp-org:device:Basic:1`
- Server Header: `Linux/3.14.0 UPnP/1.0 IpBridge/1.41.0`
- Bridge ID Format: `{MAC[0:6]}FFFE{MAC[6:12]}`
- Interval: 10 Sekunden

## Konfiguration

**Netzwerk:**
- Host (IP-Adresse)
- Port (HTTP, default: 8080)
- UPnP Port (default: 1900)
- HTTPS Port (optional)
- MAC-Adresse (optional, auto-generiert)

**Geräte:**
- Name, Light Type, State Mappings über Admin UI

## Authentifizierung

1. **Whitelist** (Standard): Benutzer aus Pairing in ioBroker States
2. **Pairing-Modus**: 50s Fenster zum Hinzufügen
3. **Disabled Auth**: Bypass für Testing (`disableAuth` State)

## Wichtige Typen

### BridgeIdentity (`src/types/config.ts`)
```typescript
interface BridgeIdentity {
  udn: string;           // UUID v4
  mac: string;           // MAC-Adresse
  bridgeId: string;      // MAC + FFFE (Hue-Format)
  modelId: string;       // "BSB002"
  serialNumber: string;  // MAC ohne Doppelpunkte
}
```

### HueApiError (`src/types/errors.ts`)
```typescript
enum HueErrorType {
  UNAUTHORIZED_USER = 1,
  INVALID_JSON = 2,
  RESOURCE_NOT_AVAILABLE = 3,
  LINK_BUTTON_NOT_PRESSED = 101,
}
```

## State-Rollen (`src/definition/roles.ts`)
```typescript
state: {
  on: 'switch.light',
  bri: 'level.dimmer',
  ct: 'level.color.temperature',
  hue: 'level.color.hue',
  sat: 'level.color.saturation',
  reachable: 'indicator.reachable'
}
```

## Fehlerbehandlung

Alle Fehler werden als HTTP 200 mit Hue-Format zurückgegeben:
```json
[{
  "error": {
    "type": 1,
    "address": "/api/unknown/lights/1",
    "description": "unauthorized user"
  }
}]
```

## Repository

- **GitHub:** https://github.com/krobipd/ioBroker.hueemu
- **Author:** krobi (krobi@power-dreams.com)
- **Original Author:** Christopher Holomek (@holomekc)
- **Lizenz:** MIT

## Release-Workflow

`manual-review` Plugin in `.releaseconfig.json` blockiert interaktiv → manueller Workaround:
```bash
# Manuell: Version in package.json + io-package.json bumpen
# CHANGELOG.md + README.md (Badge + Changelog-Section) aktualisieren
# io-package.json news (alle 11 Sprachen) hinzufügen
npm run build
git add package.json io-package.json CHANGELOG.md README.md build/ src/
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push && git push origin vX.Y.Z
```

## Versionshistorie

| Version | Datum | Änderungen |
|---------|-------|------------|
| 1.0.13 | 2026-03-19 | Fix: onoff → LWB007/Dimmable (Harmony-kompatibel), capabilities-Feld entfernt |
| 1.0.12 | 2026-03-19 | Logging: Lichtbefehle von info auf debug |
| 1.0.11 | 2026-03-19 | Logging verbessert: Pairing-Start/-Stop, Bridge-Identität, Auth-Status |
| 1.0.10 | 2026-03-19 | Fix: type-spezifische capabilities (rückgängig in 1.0.13) |
| 1.0.9 | 2026-03-19 | Fix: stabile Bridge-Identität (UDN/MAC persistieren), SSDP case-insensitive, serialNumber fix |
| 1.0.8 | 2026-03-18 | Fix: PUT /groups/:id/action → Harmony Hub kompatibel |
| 1.0.7 | 2026-03-18 | Code cleanup: dead code, DRY routes, README ohne Dev-Sektion |
| 1.0.6 | 2026-03-17 | npm Trusted Publishing (OIDC), release-script, README auf Englisch |
| 1.0.5 | 2026-03-16 | ioBroker Repochecker Fixes: Copyright, LICENSE, responsive UI |
| 1.0.4 | 2026-03-15 | uuid 13, sinon 21, dead code entfernt |
| 1.0.3 | 2026-03-15 | Code-Bereinigung, ungenutzte Dependencies/Code entfernt |
| 1.0.0 | 2026-03-09 | Major Rewrite: Fastify, moderne Admin UI |
| 0.0.x | 2020-2024 | Original von Christopher Holomek |
