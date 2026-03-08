# 🛠️ Tools-Übersicht: Chaos verhindern

## 📁 Erstellte Dateien:

| Datei | Zweck | Wie nutzen |
|-------|-------|-----------|
| **`.gitignore`** | Git-Ignore Regeln | Wird direkt verwendet |
| **`scripts/check-structure.sh`** | Prüft Projektstruktur | `./scripts/check-structure.sh` |
| **`scripts/cleanup-project.sh`** | Räumt automatisch auf | `./scripts/cleanup-project.sh` |
| **`scripts/git-pre-commit-hook.sh`** | Automatische Commit-Prüfung | In `.git/hooks/` kopieren |
| **`docs/PROJECT-RULES.md`** | Dokumentation der Regeln | Lesen! |
| **`docs/SETUP-PREVENTION.md`** | Setup-Anleitung | Folgen! |

---

## 🚀 Quick Setup (30 Sekunden):

```bash
# 1. .gitignore pruefen (bereits aktiv)

# 2. Scripts ausführbar machen
chmod +x scripts/check-structure.sh scripts/cleanup-project.sh scripts/git-pre-commit-hook.sh

# 3. Pre-Commit Hook aktivieren (optional)
cp scripts/git-pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# 4. Testen
./scripts/check-structure.sh
```

---

## 📋 Tägliche Nutzung:

### Morning Check:
```bash
./scripts/check-structure.sh
```
→ Zeigt ob alles sauber ist

### Vor jedem Commit:
```bash
git status
```
→ Prüfe manuell was du committest

### Bei Chaos:
```bash
./scripts/cleanup-project.sh
```
→ Automatisches Aufräumen (mit Backup!)

---

## 🛡️ Was wird verhindert:

- ❌ `*.old`, `*.backup`, `*.bak` Dateien
- ❌ `file 2.txt` (macOS Duplikate)
- ❌ `*-optimized.*` (Experimentelle Versionen)
- ❌ Mehrere READMEs
- ❌ Fehlplatzierte Dateien im Root
- ❌ Unstrukturierte Dateinamen

---

## 🔍 Wie funktioniert's:

### `.gitignore` (automatisch):
Git ignoriert Dateien basierend auf Patterns.

### `check-structure.sh` (manuell):
Scannt Projekt und zeigt Probleme.

### `cleanup-project.sh` (manuell):
Löscht problematische Dateien automatisch.

### Pre-Commit Hook (automatisch):
Prüft bei `git commit` und blockiert bei Problemen.

---

## 💡 Best Practices:

1. **Täglich** `check-structure.sh` ausführen
2. **Vor jedem Commit** `git status` prüfen
3. **Niemals** Dateien mit `.old`, `.backup` etc. committen
4. **Nutze Git Branches** für Experimente statt Datei-Kopien
5. **Nutze Git Commits** für Backups statt Datei-Umbenennungen

---

## 🎓 Workflow-Beispiele:

### ✅ RICHTIG - Experiment mit Branch:
```bash
git checkout -b experiment/optimize
# Änderungen machen...
git commit -m "Experiment: Optimierung"
# Falls gut: mergen, falls schlecht: löschen
```

### ❌ FALSCH - Datei-Kopien:
```bash
cp main.ts main-optimized.ts  # ❌ Nicht machen!
```

### ✅ RICHTIG - Backup mit Git:
```bash
git add .
git commit -m "Backup vor großen Änderungen"
# Jetzt kannst du gefahrlos experimentieren
```

### ❌ FALSCH - Datei-Umbenennung:
```bash
mv main.ts main.old.ts  # ❌ Nicht machen!
```

---

## 📊 Erfolgs-Metriken:

Nach Setup sollte:
- ✅ `./scripts/check-structure.sh` → Keine Probleme zeigen
- ✅ `git status` → Nur gewollte Dateien zeigen
- ✅ `ls -la` → Keine `*.old`, `* 2.*` Dateien

---

## 🆘 Troubleshooting:

**Problem:** "Permission denied"  
**Lösung:** `chmod +x script-name.sh`

**Problem:** "Script not found"  
**Lösung:** `./script-name.sh` (mit `./` davor!)

**Problem:** Pre-Commit Hook funktioniert nicht  
**Lösung:** `chmod +x .git/hooks/pre-commit`

**Problem:** Zu viele Dateien im `git status`  
**Lösung:** `.gitignore` aktualisieren und `./scripts/cleanup-project.sh`

---

## 🎯 Ziel erreicht wenn:

- ✅ Nur 20-25 Dateien/Ordner im Root
- ✅ Keine `.old`, `.backup` Dateien
- ✅ Keine macOS Duplikate
- ✅ Eine saubere Projektstruktur
- ✅ `./scripts/check-structure.sh` zeigt ✅

---

**Happy Coding! 🚀**
