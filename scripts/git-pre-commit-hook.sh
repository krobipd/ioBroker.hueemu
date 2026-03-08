#!/bin/bash

# ============================================
# Git Pre-Commit Hook für ioBroker.hueemu
# Verhindert das Committen problematischer Dateien
# ============================================

# Farben für Output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔍 Prüfe Dateien vor dem Commit...${NC}"

# ============================================
# 1. Prüfe auf Backup/Alte Dateien
# ============================================
BACKUP_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E "\.(old|backup|bak|tmp|temp)$")

if [ -n "$BACKUP_FILES" ]; then
    echo -e "${RED}❌ FEHLER: Backup/Alte Dateien gefunden:${NC}"
    echo "$BACKUP_FILES"
    echo ""
    echo -e "${YELLOW}💡 Diese Dateien sollten nicht committed werden!${NC}"
    echo "   Lösung: Füge sie zu .gitignore hinzu oder lösche sie."
    exit 1
fi

# ============================================
# 2. Prüfe auf macOS Duplikate
# ============================================
DUPLICATE_FILES=$(git diff --cached --name-only --diff-filter=A | grep -E " [0-9]\.")

if [ -n "$DUPLICATE_FILES" ]; then
    echo -e "${RED}❌ FEHLER: macOS Duplikate gefunden:${NC}"
    echo "$DUPLICATE_FILES"
    echo ""
    echo -e "${YELLOW}💡 Dateien wie 'file 2.txt' sollten nicht committed werden!${NC}"
    echo "   Lösung: Umbenennen oder löschen."
    exit 1
fi

# ============================================
# 3. Prüfe auf fehlplatzierte Dateien im Root
# ============================================
ROOT_MISPLACED=$(git diff --cached --name-only --diff-filter=A | grep -E "^(src|test|docs|admin)[a-z]+\.(ts|js|md)$")

if [ -n "$ROOT_MISPLACED" ]; then
    echo -e "${RED}❌ FEHLER: Fehlplatzierte Dateien im Root:${NC}"
    echo "$ROOT_MISPLACED"
    echo ""
    echo -e "${YELLOW}💡 Diese Dateien haben keine Verzeichnis-Trennung!${NC}"
    echo "   Beispiel: 'srcmain.ts' sollte 'src/main.ts' sein"
    echo "   Lösung: Dateien löschen oder korrekt verschieben."
    exit 1
fi

# ============================================
# 4. Prüfe auf mehrere READMEs
# ============================================
README_COUNT=$(git diff --cached --name-only --diff-filter=A | grep -i "^README" | wc -l)

if [ "$README_COUNT" -gt 1 ]; then
    echo -e "${RED}❌ FEHLER: Mehrere README-Dateien gefunden!${NC}"
    git diff --cached --name-only --diff-filter=A | grep -i "^README"
    echo ""
    echo -e "${YELLOW}💡 Es sollte nur EINE README.md im Root geben!${NC}"
    exit 1
fi

# ============================================
# 5. Prüfe auf -optimized/-experimental Dateien
# ============================================
EXPERIMENTAL=$(git diff --cached --name-only --diff-filter=A | grep -E -- "-(optimized|experimental|test|neu|alt)\.(ts|js)$")

if [ -n "$EXPERIMENTAL" ]; then
    echo -e "${RED}❌ FEHLER: Experimentelle Dateien gefunden:${NC}"
    echo "$EXPERIMENTAL"
    echo ""
    echo -e "${YELLOW}💡 Nutze stattdessen Git Branches für Experimente!${NC}"
    echo "   git checkout -b feature/experiment"
    exit 1
fi

# ============================================
# Alles OK!
# ============================================
echo -e "${GREEN}✅ Alle Checks bestanden!${NC}"
exit 0
