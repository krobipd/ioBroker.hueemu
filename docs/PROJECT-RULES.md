# 📋 Projektstruktur-Regeln

## 🎯 Ziel: Chaos vermeiden!

Diese Datei definiert klare Regeln, um das Projekt sauber zu halten.

---

## ✅ ERLAUBT:

### Im Root-Verzeichnis:
- `README.md` (nur EINE!)
- `CHANGELOG.md`
- `LICENSE`
- `package.json`, `package-lock.json`
- `tsconfig.json`, `tsconfig.build.json`
- `.gitignore`, `.npmignore`, `.eslintrc.json`
- Standard-Verzeichnisse: `src/`, `test/`, `docs/`, `scripts/`, `admin/`, `templates/`

### In Unterverzeichnissen:
- Alle Source-Dateien in `src/`
- Alle Tests in `test/`
- Alle Dokumentation in `docs/`
- Admin-UI in `admin/`

---

## ❌ NICHT ERLAUBT:

### Backup/Alte Dateien:
- `*.old`
- `*.backup`
- `*.bak`
- `*.tmp`
- `*.temp`
- `*~`
- `*.orig`
- `*.save`

### macOS Duplikate:
- `file 2.txt` (Finder-Kopien)
- `file 3.txt`
- `file copy.txt`
- `*Kopie*`

### Experimentelle Dateien:
- `*-optimized.*` → Nutze Git Branches!
- `*-experimental.*`
- `*-test.*`
- `*-neu.*`, `*-alt.*`

### Mehrfache Dateien:
- Mehrere `README*.md` im Root
- Duplizierte Configs (`tsconfig 2.json`)

### Fehlplatzierte Dateien:
- `srcmain.ts` im Root (sollte `src/main.ts` sein)
- `testunit*.ts` im Root (sollte `test/unit/*.ts` sein)
- `docs*.md` im Root (sollte `docs/*.md` sein)

---

## 🛠️ Tools zum Prüfen & Aufräumen

### 1. Struktur prüfen:
```bash
./scripts/check-structure.sh
```

Zeigt alle problematischen Dateien.

### 2. Automatisch aufräumen:
```bash
./scripts/cleanup-project.sh
```

Löscht automatisch alte/problematische Dateien (mit Backup!).

### 3. Vor jedem Commit:
```bash
git status
```

Prüfe was du committest! Nur gewollte Dateien hinzufügen.

---

## 🔧 Git Pre-Commit Hook (Optional)

Automatische Prüfung **vor jedem Commit**:

```bash
# Installieren:
cp scripts/git-pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit

# Dann bei jedem Commit automatisch geprüft!
```

---

## 📝 Workflow-Empfehlungen

### Wenn du experimentieren willst:
```bash
# NICHT: Datei kopieren und umbenennen!
# ❌ cp main.ts main-optimized.ts

# STATTDESSEN: Git Branch verwenden!
# ✅
git checkout -b experiment/optimize-performance
# ... Änderungen machen ...
git commit -m "Experiment: Performance-Optimierung"
```

### Wenn du Code sichern willst:
```bash
# NICHT: Datei umbenennen!
# ❌ mv main.ts main.old.ts

# STATTDESSEN: Git Commit!
# ✅
git add main.ts
git commit -m "feat: Neue Funktion implementiert"
# Die alte Version ist in der Git-Historie!
```

### Wenn du aufräumen willst:
```bash
# Regelmäßig prüfen:
./scripts/check-structure.sh

# Bei Problemen automatisch aufräumen:
./scripts/cleanup-project.sh

# Oder manuell:
git status
# Ungewollte Dateien löschen
```

---

## 🎓 Warum diese Regeln?

1. **Übersichtlichkeit** - Jeder findet sofort was er sucht
2. **Git-Effizienz** - Keine unnötigen Dateien im Repository
3. **Professionalität** - Projekt sieht sauber aus
4. **Wartbarkeit** - Keine Verwirrung durch Duplikate
5. **Teamwork** - Klare Struktur für alle Contributors

---

## ❓ FAQ

**Q: Ich will eine Datei sichern bevor ich sie ändere!**  
A: Nutze Git! `git commit` BEVOR du änderst. Die alte Version bleibt in der Historie.

**Q: Ich will verschiedene Versionen ausprobieren!**  
A: Nutze Git Branches! `git checkout -b experiment/meine-idee`

**Q: Finder hat automatisch "file 2.txt" erstellt!**  
A: Lösche es sofort! Oder füge es zu `.gitignore` hinzu (ist schon drin).

**Q: Ich habe versehentlich `.old` Dateien committed!**  
A: Kein Problem! `git rm *.old`, dann `git commit`.

---

## 📞 Hilfe

Bei Fragen oder Problemen: GitHub Issues öffnen!

---

**Letzte Aktualisierung:** März 2026  
**Version:** 1.0
