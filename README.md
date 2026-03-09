# ioBroker.hueemu

![Logo](admin/hue-emu-logo.png)

## Philips Hue Bridge Emulator für ioBroker

Emuliert eine Philips Hue Bridge und ermöglicht die Steuerung von ioBroker-Geräten über Alexa, Google Home und andere Smart Home Systeme.

### Features

- **Hue Bridge Emulation** - Vollständige Hue API v1 Kompatibilität
- **UPnP/SSDP Discovery** - Automatische Erkennung durch Smart Home Systeme
- **Moderne Admin-UI** - JSON-Config für einfache Gerätekonfiguration
- **Flexible Geräte** - On/Off, Dimmbar, Farbtemperatur, RGB Lampen
- **Import/Export** - Gerätekonfiguration sichern und wiederherstellen

### Systemanforderungen

- ioBroker js-controller >= 7.0.0
- Node.js >= 20.0.0

### Installation

```bash
# Via ioBroker Admin (Custom URL):
iobroker url https://github.com/krobipd/ioBroker.hueemu

# Oder manuell:
cd /opt/iobroker
npm install https://github.com/krobipd/ioBroker.hueemu
iobroker add hueemu
```

### Konfiguration

#### 1. Netzwerk-Einstellungen

| Einstellung | Beschreibung | Standard |
|-------------|--------------|----------|
| Host | IP-Adresse der Bridge | - |
| HTTP Port | Port für Hue API | 8080 |
| UPnP Port | SSDP Discovery Port | 1900 |

#### 2. Geräte hinzufügen

1. Tab "Geräte-Konfiguration" öffnen
2. `+` Button klicken
3. **Name** eingeben (z.B. "Wohnzimmer Licht")
4. **Lampentyp** wählen:
   - Ein/Aus-Lampe
   - Dimmbare Lampe
   - Farbtemperatur
   - Farblampe (RGB)
5. **States zuordnen** via Objekt-Browser (`...`)

#### 3. Mit Alexa verbinden

1. Adapter starten
2. Alexa App → Geräte → `+` → Philips Hue
3. Bridge wird automatisch gefunden
4. "Alexa, schalte Wohnzimmer Licht ein"

### Unterstützte Lampentypen

| Typ | States | Hue Model |
|-----|--------|-----------|
| On/Off | `on` | LOM001 |
| Dimmbar | `on`, `bri` | LWB010 |
| Farbtemperatur | `on`, `bri`, `ct` | LTW001 |
| Farblampe | `on`, `bri`, `ct`, `hue`, `sat`, `xy` | LCT003 |

### Entwicklung

```bash
git clone https://github.com/krobipd/ioBroker.hueemu.git
cd ioBroker.hueemu

npm install
npm run build
npm test
```

### Credits

**Original Author:** Christopher Holomek ([@holomekc](https://github.com/holomekc))

**Modernization (2026):** krobi & AI Assistant

### Links

- [GitHub Repository](https://github.com/krobipd/ioBroker.hueemu)
- [Issues](https://github.com/krobipd/ioBroker.hueemu/issues)
- [ioBroker Forum](https://forum.iobroker.net/)

### Lizenz

MIT License - Copyright (c) 2020-2026
