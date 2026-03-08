#!/bin/bash

# ============================================
# Automatisches Aufraeum-Script
# Loescht problematische Dateien
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/.cleanup-backups"
cd "$REPO_ROOT" || exit 1

echo -e "${BLUE}"
echo "========================================"
echo "  Automatisches Aufraeumen"
echo "========================================"
echo -e "${NC}\n"

# ============================================
# Backup erstellen
# ============================================
echo -e "${YELLOW}Erstelle Backup...${NC}"
mkdir -p "$BACKUP_DIR"
BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

tar -czf "$BACKUP_PATH" \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./.cleanup-backups' \
    . 2>/dev/null

echo -e "${GREEN}Backup: $BACKUP_PATH${NC}\n"

# ============================================
# 1. Alte Dateien loeschen
# ============================================
echo -e "${YELLOW}Loesche alte Dateien...${NC}"
find . -type f \( -name "*.old" -o -name "*.backup" -o -name "*.bak" -o -name "*.tmp" -o -name "*.temp" -o -name "*~" \) \
    -not -path "./node_modules/*" \
    -not -path "./.git/*" \
    -print -delete 2>/dev/null
echo -e "${GREEN}Alte Dateien entfernt${NC}\n"

# ============================================
# 2. macOS Duplikate loeschen
# ============================================
echo -e "${YELLOW}Loesche macOS Duplikate...${NC}"
find . -type f \( -name "* 2.*" -o -name "* 3.*" -o -name "*Kopie*" \) \
    -not -path "./node_modules/*" \
    -not -path "./.git/*" \
    -print -delete 2>/dev/null
echo -e "${GREEN}Duplikate entfernt${NC}\n"

# ============================================
# 3. Experimentelle Dateien loeschen
# ============================================
echo -e "${YELLOW}Loesche experimentelle Dateien...${NC}"
find . -type f \( -name "*-optimized.*" -o -name "*-experimental.*" -o -name "*-test.*" -o -name "*-neu.*" -o -name "*-alt.*" \) \
    -not -path "./node_modules/*" \
    -not -path "./.git/*" \
    -print -delete 2>/dev/null
echo -e "${GREEN}Experimentelle Dateien entfernt${NC}\n"

# ============================================
# 4. Fehlplatzierte Dateien warnen
# ============================================
echo -e "${YELLOW}Pruefe fehlplatzierte Dateien...${NC}"
MISPLACED=$(find . -maxdepth 1 -type f \( -name "src*" -o -name "test*" -o -name "docs*" -o -name "admin*" \))

if [ -n "$MISPLACED" ]; then
    echo -e "${RED}Fehlplatzierte Dateien gefunden:${NC}"
    echo "$MISPLACED" | sed 's/^/   /'
    echo ""
    echo -e "${YELLOW}Diese manuell pruefen und ggf. verschieben/loeschen.${NC}"
else
    echo -e "${GREEN}Keine fehlplatzierten Dateien${NC}"
fi
echo ""

# ============================================
# Fertig!
# ============================================
echo -e "${BLUE}"
echo "========================================"
echo "  Aufraeumen abgeschlossen"
echo "========================================"
echo -e "${NC}\n"

echo -e "${GREEN}Naechste Schritte:${NC}"
echo "   1. Pruefe mit: git status"
echo "   2. Teste mit: ./scripts/check-structure.sh"
echo ""
