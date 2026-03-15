# ioBroker.hueemu

![Version](https://img.shields.io/badge/version-1.0.2-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![License](https://img.shields.io/badge/license-MIT-green)

![Logo](admin/hue-emu-logo.png)

Emuliert eine Philips Hue Bridge (v2, BSB002) und ermöglicht die Steuerung von ioBroker-Geräten über Alexa, Google Home und andere Hue-kompatible Smart Home Systeme.

---

## Funktionen

- **Hue Bridge Emulation** - Vollständige Hue API v1 Kompatibilität
- **UPnP/SSDP Discovery** - Automatische Erkennung durch Smart Home Systeme
- **Moderne Admin-UI** - JSON-Config für einfache Gerätekonfiguration
- **Flexible Geräte** - On/Off, Dimmbar, Farbtemperatur, RGB Lampen

---

## Voraussetzungen

- **Node.js ≥ 20** (getestet mit 20, 22, 24 LTS)
- **ioBroker js-controller ≥ 7.0.0**
- **ioBroker Admin ≥ 7.0.0**

---

## Installation

```bash
cd /opt/iobroker
npm install iobroker.hueemu
iobroker add hueemu
```

Oder über die ioBroker Admin-Oberfläche (Custom URL):
```bash
iobroker url https://github.com/krobipd/ioBroker.hueemu
```

---

## Konfiguration

### Netzwerk-Einstellungen

| Option | Beschreibung | Standard |
|--------|--------------|----------|
| **Host** | IP-Adresse der Bridge | - |
| **HTTP Port** | Port für Hue API | 8080 |
| **UPnP Port** | SSDP Discovery Port | 1900 |
| **HTTPS Port** | Optionaler HTTPS Port | - |
| **MAC-Adresse** | Bridge MAC (auto-generiert) | - |

### Geräte hinzufügen

1. Tab "Geräte-Konfiguration" öffnen
2. `+` Button klicken
3. **Name** eingeben (z.B. "Wohnzimmer Licht")
4. **Lampentyp** wählen
5. **States zuordnen** via Objekt-Browser (`...`)

### Unterstützte Lampentypen

| Typ | States | Hue Model |
|-----|--------|-----------|
| **On/Off** | `on` | LOM001 |
| **Dimmbar** | `on`, `bri` | LWB010 |
| **Farbtemperatur** | `on`, `bri`, `ct` | LTW001 |
| **Farblampe** | `on`, `bri`, `ct`, `hue`, `sat`, `xy` | LCT003 |

### Mit Alexa verbinden

1. Adapter starten
2. Alexa App → Geräte → `+` → Philips Hue
3. Bridge wird automatisch gefunden
4. "Alexa, schalte Wohnzimmer Licht ein"

---

## Troubleshooting

### Bridge wird nicht gefunden

- Prüfen, ob UPnP Port (1900) nicht blockiert ist
- Host-IP muss die tatsächliche Netzwerk-IP sein (nicht 0.0.0.0)
- Firewall-Regeln prüfen

### Alexa findet keine Geräte

- Pairing-Modus aktivieren (50 Sekunden Fenster)
- Sicherstellen, dass mindestens ein Gerät konfiguriert ist
- Adapter-Logs auf Fehler prüfen

### State-Änderungen funktionieren nicht

- State-IDs in der Gerätekonfiguration prüfen
- Wertebereich beachten: `bri` 0-100 oder 0-1, `ct` 153-500 (Mireds)

---

## Entwicklung

Der Adapter ist vollständig in **TypeScript** geschrieben mit `strict` Mode.

```bash
npm run build      # Build
npm test           # Tests
npm run lint       # Lint
npm run watch      # Watch-Mode
```

### Projektstruktur

```
src/
├── main.ts                    # Adapter-Hauptklasse
├── definition/                # ioBroker-Definitionen
├── discovery/                 # UPnP/SSDP Discovery
├── hue-api/                   # Hue API Implementation
├── server/                    # HTTP Server (Fastify)
└── types/                     # TypeScript Typen
test/                          # Tests
build/                         # Kompilierter Code
```

### Technologie-Stack

| Komponente | Version |
|------------|---------|
| TypeScript | 5.8.3 |
| Fastify | 5.8.2 |
| @iobroker/adapter-core | 3.3.2 |
| node-ssdp | 4.0.1 |

---

## Changelog

Siehe [CHANGELOG.md](CHANGELOG.md).

---

## Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization (2026):** krobi & AI Assistant

---

## Links

- [GitHub Repository](https://github.com/krobipd/ioBroker.hueemu)
- [Issues](https://github.com/krobipd/ioBroker.hueemu/issues)
- [ioBroker Forum](https://forum.iobroker.net/)

---

## Lizenz

MIT License - siehe [LICENSE](LICENSE)

---

*Entwickelt mit Unterstützung von Claude.ai*
