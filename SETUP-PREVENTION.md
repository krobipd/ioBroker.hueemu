# 🚀 Setup: Chaos-Prävention aktivieren

## Was du brauchst:
- ✅ Git (hast du)
- ✅ Terminal (hast du)
- ❌ **KEIN** npm oder Node.js nötig!

---

## 📦 1. `.gitignore` aktualisieren

```bash
# Alte .gitignore ersetzen:
cp .gitignore.template .gitignore

# Oder manuell öffnen und erweitern
```

✅ **Resultat:** Git ignoriert automatisch `.old`, `.backup`, `* 2.*` etc.

---

## 🔧 2. Scripts ausführbar machen

```bash
chmod +x check-structure.sh
chmod +x cleanup-project.sh
chmod +x git-pre-commit-hook.sh
```

✅ **Resultat:** Scripts können ausgeführt werden

---

## 🛡️ 3. Git Pre-Commit Hook aktivieren (optional)

```bash
cp git-pre-commit-hook.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

✅ **Resultat:** Bei jedem `git commit` automatische Prüfung!

---

## 🧪 4. Testen

```bash
# Prüfe die aktuelle Struktur:
./check-structure.sh

# Sollte zeigen:
# ✅ Projektstruktur ist sauber!
```

---

## 📋 5. Tägliche Nutzung

### Vor dem Arbeiten:
```bash
./check-structure.sh
```

### Nach dem Arbeiten:
```bash
git status
# Prüfe was du committest!
```

### Wenn Chaos entsteht:
```bash
./cleanup-project.sh
# Räumt automatisch auf (mit Backup!)
```

---

## ✅ Fertig!

Ab jetzt:
- 🛡️ `.gitignore` verhindert unerwünschte Dateien
- 🔍 `check-structure.sh` findet Probleme
- 🧹 `cleanup-project.sh` räumt auf
- 🚫 Pre-Commit Hook blockiert Fehler (optional)

---

## 🆘 Hilfe

Lies: `PROJECT-RULES.md` für alle Regeln
