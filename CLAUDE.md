# CLAUDE.md - ioBroker Hue Emulator Adapter

## Projektübersicht

Der **ioBroker Hue Emulator** emuliert eine Philips Hue Bridge (v2, BSB002), damit ioBroker-Geräte über Alexa, Google Home und andere Hue-kompatible Systeme gesteuert werden können.

## Technologie-Stack

- **Framework:** ioBroker Adapter Core (Node.js)
- **HTTP Server:** Fastify v4.26
- **Discovery:** node-ssdp v4.0.1 (UPnP/SSDP)
- **TLS:** Node-forge (Zertifikatsgenerierung)
- **Sprache:** TypeScript 5.6
- **Testing:** Mocha + Chai + Sinon

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
├── types/                     # TypeScript Typen
│   ├── index.ts
│   ├── config.ts              # Konfigurationstypen
│   ├── errors.ts              # HueApiError Klasse
│   ├── hue-api.ts             # API Request/Response Typen
│   └── light.ts               # Light Objekt Typen
└── util/
    └── utils.ts               # Hilfsfunktionen

templates/                     # Light Templates (JSON)
├── on-off-light.json
├── dimmable-light.json
├── color-temperature-light.json
├── extended-color-light.json
├── on-off-plug.json
└── wrapper.json

admin/                         # Admin UI
├── jsonConfig.json5           # Konfigurationsschema
├── i18n/                      # Übersetzungen (de, en, ...)
└── hue-emu-logo.png
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

### Light-Typen
| Typ | States | Model ID | Hue Type |
|-----|--------|----------|----------|
| onoff | on | LOM001 | On/Off light |
| dimmable | on, bri | LWB010 | Dimmable light |
| ct | on, bri, ct | LTW001 | Color temperature light |
| color | on, bri, hue, sat, ct, xy | LCT003 | Extended color light |

### Wertekonvertierung
- **bri**: 0-100 oder 0-1 → 1-254
- **sat**: 0-100 → 0-254
- **hue**: beliebig → 0-65535
- **ct**: 153-500 (Mireds)
- **xy**: Array [x,y] oder String "x,y"

## Hue API Endpoints

```
POST /api                              → createUser (Pairing)
GET  /api/:username                    → getFullState
GET  /api/:username/config             → getConfig
GET  /api/:username/lights             → getAllLights
GET  /api/:username/lights/:id         → getLightById
PUT  /api/:username/lights/:id/state   → setLightState
GET  /api/:username/{groups,...}       → leere Collections
GET  /description.xml                  → UPnP Device Description
GET  /health                           → Health Check
```

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

## Build-Befehle

```bash
npm run build:ts    # TypeScript kompilieren
npm run build       # Vollständiger Build
npm run watch       # Watch-Modus
npm run test        # Tests ausführen
npm run lint        # ESLint
npm run lint:fix    # ESLint mit Auto-Fix
```

## Versionierung

```bash
npm run version:patch  # 1.0.0 -> 1.0.1
npm run version:minor  # 1.0.0 -> 1.1.0
npm run version:major  # 1.0.0 -> 2.0.0
npm run release        # Build + Patch Version
```

Das Versionierungs-Script (`scripts/version.js`) hält `package.json` und `io-package.json` synchron und erstellt automatisch Git Tags.

## GitHub Actions

- **CI** (`.github/workflows/ci.yml`): Build, Lint, Test bei Push/PR
- **Release** (`.github/workflows/release.yml`): Automatisches Release bei Tag-Push (v*)

## TypeScript-Konfiguration

- Target: ES2020
- Module: CommonJS
- Strict Mode: aktiviert
- Output: `build/`

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
  // ...
}
```

### Light (`src/types/light.ts`)
```typescript
interface Light {
  state: LightState;
  type: string;
  name: string;
  modelid: string;
  manufacturername: string;
  uniqueid: string;
  swversion: string;
  // ...
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

## Abhängigkeiten

- ioBroker/adapter-core
- Fastify v4.26
- node-ssdp v4.0.1
- node-forge (TLS)
- js-controller >= 7.0.0

## Tests

- Unit Tests: `src/main.test.ts`, `test/unit.js`
- Integration Tests: `test/integration.js`
- Package Tests: `test/package.js`
- Framework: Mocha + Chai + Sinon + @iobroker/testing
