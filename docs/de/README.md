# hueemu — eine Philips-Hue-Bridge für Geräte, die nur Hue sprechen

Dieser Adapter lässt ioBroker im lokalen Netz wie eine **Philips-Hue-Bridge**
aussehen (eine v2-Bridge, Modell BSB002). Alles, was Hue-Lampen über die Hue-API
steuern kann — ein Logitech-Harmony-Hub, ein älterer Echo, ein Wandpanel, eine
eingestellte Dashboard-App — sieht die von dir veröffentlichten Lampen und schaltet sie.
Clients, die das Netz per SSDP absuchen (Alexa, Harmony), finden die Bridge selbst;
jedem anderen Client gibst du ihre IP-Adresse. Hinter jeder dieser „Lampen" steckt ein
ioBroker-Datenpunkt deiner Wahl.

Es ist das Gegenstück zu einer echten Bridge: statt Philips-Hardware antwortet deine
ioBroker-Instanz — und die Lampen, die sie anbietet, können alles sein, was der
Objektbaum kennt, von der Zigbee-Lampe über den KNX-Dimmer bis zum Relais in einer
Heizungssteuerung.

> **Unterstützt dein Sprachassistent Matter, nimm den [Matter-Adapter](https://github.com/ioBroker/ioBroker.matter).**
> Aktuelle Geräte von Alexa, Google Home und Apple Home sprechen alle Matter, und das
> ist in jeder Hinsicht der bessere Weg. Dieser Adapter ist für Geräte da, die kein
> Matter können und es auch nie bekommen werden.

## Voraussetzungen

- Node.js 22 oder neuer
- js-controller 7.2.2 oder neuer
- Admin 8.0.11 oder neuer
- Client und ioBroker-Rechner im **selben lokalen Netz**

## Einrichten

### 1. Instanz anlegen

Adapter installieren, eine Instanz anlegen. Die Instanz wird **gestoppt** angelegt:
erst Host / IP-Adresse und Port wählen (Schritte 2 und 3), dann starten. Sie lauscht auf
Port 8080, solange du keinen anderen wählst.

### 2. Host / IP-Adresse

Lass **Host / IP** auf `0.0.0.0` („auf allen Schnittstellen lauschen"). Der Adapter
ermittelt dann selbst die erreichbare Adresse deines ioBroker-Rechners und kündigt
diese den Clients an.

Eine feste Adresse trägst du nur ein, wenn dein Rechner in **mehreren Netzen** hängt
und der Client ihn nur über eines davon erreicht.

### 3. Port

`8080` ist die Vorgabe und funktioniert mit einem Harmony-Hub.

**Alexa braucht Port 80, und aktuelle Echo-Geräte versuchen zusätzlich HTTPS auf 443.**
Für Alexa stellst du **Port** auf `80` und **HTTPS-Port** auf `443`; die Bridge antwortet
auf HTTPS mit ihrem eigenen, selbst signierten Zertifikat. Ein Port unter 1024 braucht
das Recht, ihn zu belegen — der ioBroker-Installer gibt es Node.js unter Linux; meldet
das Protokoll, dass der Port nicht belegt werden kann, fehlt dieses Recht.

**X-Forwarded-\* Header vertrauen** bleibt aus, außer der Adapter steht hinter einem
Reverse-Proxy, dem du vertraust und der vom Client mitgeschickte Weiterleitungs-Header
entfernt. Es ändert nur, welche Client-Adresse das Debug-Protokoll zeigt.

### 4. Lampen veröffentlichen

Öffne den Reiter **Geräte**. Jede Karte ist eine Lampe, die die Bridge anbietet.

**Automatisch** — auf **Lichter suchen** klicken. Der Adapter durchsucht deinen
Objektbaum nach allem, was sich wie eine Lampe verhält (Schalter, Dimmer,
Farbtemperatur-Lampe, Farblampe) und legt das Gefundene als Auswahlliste vor. Hake an,
was du willst; nur das wird übernommen. Was er gefunden, aber nicht zuordnen konnte,
steht anschließend als Anzahl in der Meldung — es verschwindet also nichts stillschweigend.

**Von Hand** — auf **Licht hinzufügen** klicken, Namen vergeben, Lampentyp wählen und
jedes Feld per Objektauswahl auf einen ioBroker-Datenpunkt zeigen lassen.

| Lampentyp          | Was der Client sieht                     |
| ------------------ | ---------------------------------------- |
| **Ein/Aus**        | ein und aus (als dimmbare Lampe gezeigt) |
| **Dimmbar**        | ein/aus und Helligkeit                   |
| **Farbtemperatur** | ein/aus, Helligkeit, Warm-/Kaltweiß      |
| **Farbe**          | ein/aus, Helligkeit, volle Farbe         |

Jede Lampe behält ihre Nummer dauerhaft: Lampen löschen oder umsortieren ändert für die
anderen nichts, Alexas Routinen zeigen weiter auf die Lampen, mit denen sie eingerichtet
wurden. Eine Lampe darf auch auf einen Datenpunkt zeigen, den kein Gerät bestätigt — aus
`0_userdata`, einem Skript oder einer Visualisierung — die Bridge folgt jeder Änderung
daran genauso.

### 5. Client koppeln

Ein Client darf sich erst verbinden, wenn du das Kopplungsfenster öffnest — das
entspricht dem Knopfdruck auf einer echten Bridge.

1. In den ioBroker-**Objekten** `hueemu.0.startPairing` auf `true` setzen
2. Innerhalb von **50 Sekunden** die Gerätesuche im Client starten
3. Ein neuer Eintrag unter `hueemu.0.clients.` bestätigt die Kopplung

**Alexa (älterer Echo):** Alexa-App → Geräte → `+` → Philips Hue → **Philips Hue V1**.
Hast du mehrere Echos, lass nur einen suchen. Echo-Geräte der ersten Generation können
diesen Weg nicht mehr. Alexa verwaltet höchstens 49 Lampen je Bridge — bei mehr findet
sie keine. Nimm eine emulierte Bridge je Alexa-Konto: zwei Instanzen melden ihre Lampen
unter denselben Kennungen, und Alexa verwechselt sie.

**Harmony:** MyHarmony-Desktop-Software → Geräte → Gerät hinzufügen → Nach Geräten
suchen (oder Beleuchtung → Philips Hue).

## Werteskalen — was du prüfst, wenn eine Farbe falsch aussieht

ioBroker-Adapter speichern denselben Wert in unterschiedlichen Einheiten. Den Farbton
hält der eine in Grad (0–360), der andere im Hue-eigenen Bereich 0–65535; die
Farbtemperatur steht hier in Kelvin und dort in Mired; die Helligkeit ist mal Prozent,
mal roh 0–254.

Der Adapter liest Einheit und Wertebereich aus dem Datenpunkt, den er anbindet, und legt
die Skala bei jedem Start selbst fest — für Lampen aus der Suche genauso wie für von Hand
angelegte, und in beide Richtungen: beim Lesen wie beim Schreiben. Sagt ein Datenpunkt
nichts über seine Einheit oder seinen Bereich, was etwa bei der Farbtemperatur des
Zigbee-Adapters der Fall ist, geht der Adapter nach dem Wert selbst — und schreibt ihn so
zurück, wie er ihn gelesen hat.

Reagiert eine Lampe also, zeigt aber die falsche Farbe, den falschen Weißton, oder
springt sie auf volle Helligkeit: öffne ihre Karte und stell die Skala von Hand ein.
„Automatisch (aus dem Datenpunkt)" ist die Einstellung, mit der der Adapter entscheidet.

- **Helligkeit / Sättigung** — `Prozent (0..100)` bei einem üblichen `level.dimmer`,
  `Normalisiert (0..1)`, `Hue-Roh (1..254)` bei einer Quelle im Hue-eigenen Bereich,
  oder `Byte (0..255)`
- **Farbton** — `Grad (0..360)` bei einem normalen ioBroker-Farbdatenpunkt,
  `Nativ (keine Umrechnung)` bei 0–65535
- **Farbtemperatur** — `Kelvin` bei Werten wie 2700–6500, `Nativ (keine Umrechnung)`
  bei Mired (etwa 153–500), `Prozent (0..100, 0 = kalt)` bei einem Datenpunkt, der in
  Prozent von kalt nach warm läuft

## Lampen ohne Ein/Aus-Datenpunkt

Manche Dimmer bieten nur einen Helligkeitswert und keinen eigenen Schalter — ein
HomeMatic-Dimmerkanal ist der häufigste Fall. Die funktionieren: die Helligkeit trägt
Ein/Aus. Ein Quellwert von 0 gilt als aus, alles darüber als an. Ausschalten schreibt
0; Einschalten schreibt volle Helligkeit, denn eine Quelle, die auf 0 steht, weiß ihren
früheren Wert nicht mehr.

## Was im Objektbaum entsteht

```
hueemu.0.
├── info/
│   ├── connection — ob die Bridge Hue-Clients antwortet
│   └── error      — warum nicht (leer, solange alles läuft)
├── startPairing   — öffnet das Kopplungsfenster für 50 Sekunden (Taster)
├── disableAuth    — jede Anfrage ohne Kopplung annehmen (Schalter)
└── clients/       — ein Eintrag je gekoppeltem Client
    └── <Name>     — der Schlüssel, den dieser Client benutzt
```

`info.connection` ist die schnelle Antwort auf „läuft es überhaupt?". Ein Start kann aus
Gründen scheitern, die man der Instanzliste nicht ansieht. Ein Fehler des Systems — etwa
ein schon belegter Port — steht dann unverändert in `info.error`; bei einem Problem, das
der Adapter selbst erkennt (kein Port gesetzt, keine brauchbare Netzwerkadresse), zeigt
`info.error` `Unknown`, und das Protokoll trägt die Erklärung.

Einen gekoppelten Client entfernst du, indem du seinen Eintrag unter `hueemu.0.clients`
löschst — sein Schlüssel gilt ab sofort nicht mehr.

`disableAuth` ist eine Wartungshilfe, keine Dauereinstellung: damit kann jedes Gerät in
deinem Netz deine Lampen ohne Kopplung steuern. Neue Clients sind ohnehin auf 100 pro
Stunde begrenzt; eine einzelne Warnung im Protokoll sagt dir, wann diese Grenze erreicht war.

## Ports, die der Adapter benutzt

| Port | Protokoll | Wofür                                    | Einstellbar                            |
| ---- | --------- | ---------------------------------------- | -------------------------------------- |
| 8080 | TCP       | die Hue-Schnittstelle selbst (Alexa: 80) | ja — Clients erfahren ihn per SSDP     |
| 1900 | UDP       | Erkennung, damit Clients dich finden     | nein — vom UPnP-Standard festgelegt    |
| —    | TCP       | optionales HTTPS (Alexa: 443)            | ja, aus, solange kein Port gesetzt ist |

## Wenn etwas nicht geht

**Der Client findet die Bridge nicht.** Prüfe, ob UDP-Port 1900 zwischen Client und
ioBroker-Rechner offen ist und beide im selben Netzsegment liegen — ein Gastnetz oder
ein eigenes VLAN funktioniert ohne zusätzliche Wegeleitung nicht. Hat der Rechner
mehrere Netzwerkkarten, trag unter **Host / IP** die konkrete Adresse ein statt
`0.0.0.0`. Für Alexa siehe Port 80 und HTTPS 443 oben.

**Die Kopplung schlägt fehl.** `startPairing` muss `true` sein, **bevor** du die Suche
im Client startest, und das Fenster ist nur 50 Sekunden offen. Ein Client, der sich per
Schlüsselanfrage koppelt, schließt es wieder — genau wie bei einer echten Bridge; ein
Client, der beim Abfragen der Lampen aufgenommen wird, lässt es bis zum Ende der 50
Sekunden offen.

**Eine Lampe erscheint, reagiert aber nicht.** Prüfe, ob der angebundene Datenpunkt
überhaupt beschreibbar ist. Ein Status-Datenpunkt (eine Rückmeldung dessen, was ein
Gerät berichtet) lässt sich lesen, aber nicht schreiben — die Lampe zeigt dann einen
Wert an und ignoriert jeden Befehl.

**Eine Lampe zeigt die falsche Farbe oder Helligkeit.** Siehe „Werteskalen" oben.

**Zurück auf eine Version unter 1.18.0** wird nicht unterstützt: die ältere Version
findet die Lauschadresse unter ihrem neuen Schlüssel nicht mehr und nummeriert die
Lampen neu, Alexa sieht dann andere Lampen.

**Du kommst vom alten `createLight`-Aufbau.** Deine Lampen werden beim ersten Start
automatisch umgestellt, der Adapter startet dabei einmal neu. Von Hand ist nichts zu
tun. Lohnend im Anschluss: der alte Weg nutzte adapter-eigene Datenpunkte als
Zwischenschritt, wofür ein Skript nötig war, um das echte Gerät zu fahren. Du kannst
jede Lampe jetzt direkt auf den Gerätedatenpunkt zeigen lassen und dieses Skript weglassen.

## Datenschutz

Der Adapter spricht ausschließlich mit Geräten in deinem eigenen Netz; er hat keine
Cloud-Anbindung und schickt von sich aus nichts ins Internet.

Die Fehlermeldung über Sentry ist ab Werk aktiv; was sie sendet und wie man sie abschaltet, steht im [Abschnitt Sentry der Haupt-README](../../README.md#sentry--error-reporting).
