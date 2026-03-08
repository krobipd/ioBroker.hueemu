#!/bin/bash

# ============================================
# Automatisches Aufräum-Script
# Löscht problematische Dateien
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║  Automatisches Aufräumen              ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}\n"

# ============================================
# Backup erstellen
# ============================================
echo -e "${YELLOW}📦 Erstelle Backup...${NC}"
BACKUP_NAME="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "../$BACKUP_NAME" . 2>/dev/null
echo -e "${GREEN}✅ Backup: ../$BACKUP_NAME${NC}\n"

# ============================================
# 1. Alte Dateien löschen
# ============================================
echo -e "${YELLOW}🗑️  Lösche alte Dateien...${NC}"
COUNT=0

for ext in old backup bak tmp temp; do
    FILES=$(find . -name "*.$ext" -not -path "./node_modules/*" -not -path "./.git/*")
    if [ -n "$FILES" ]; then
        echo "$FILES" | while read file; do
            rm "$file"
            echo "   ✓ Gelöscht: $file"
            COUNT=$((COUNT + 1))
        done
    fi
done

# Tilde-Dateien
find . -name "*~" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null

echo -e "${GREEN}✅ Alte Dateien entfernt${NC}\n"

# ============================================
# 2. macOS Duplikate löschen
# ============================================
echo -e "${YELLOW}🗑️  Lösche macOS Duplikate...${NC}"
find . -name "* 2.*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
find . -name "* 3.*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
find . -name "*Kopie*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
echo -e "${GREEN}✅ Duplikate entfernt${NC}\n"

# ============================================
# 3. Experimentelle Dateien löschen
# ============================================
echo -e "${YELLOW}🗑️  Lösche experimentelle Dateien...${NC}"
find . -name "*-optimized.*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
find . -name "*-experimental.*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
find . -name "*-test.*" -not -path "./node_modules/*" -not -path "./.git/*" -delete 2>/dev/null
echo -e "${GREEN}✅ Experimentelle Dateien entfernt${NC}\n"

# ============================================
# 4. Fehlplatzierte Dateien warnen
# ============================================
echo -e "${YELLOW}⚠️  Prüfe fehlplatzierte Dateien...${NC}"
MISPLACED=$(find . -maxdepth 1 -type f \( -name "src*" -o -name "test*" -o -name "docs*" -o -name "admin*" \) | grep -v "^\./src$" | grep -v "^\./test$" | grep -v "^\./docs$" | grep -v "^\./admin$")

if [ -n "$MISPLACED" ]; then
    echo -e "${RED}⚠️  Fehlplatzierte Dateien gefunden:${NC}"
    echo "$MISPLACED" | sed 's/^/   /'
    echo ""
    echo -e "${YELLOW}💡 Diese manuell prüfen und ggf. löschen!${NC}"
else
    echo -e "${GREEN}✅ Keine fehlplatzierten Dateien${NC}"
fi
echo ""

# ============================================
# Fertig!
# ============================================
echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║          Aufräumen abgeschlossen!     ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}\n"

echo -e "${GREEN}✅ Nächste Schritte:${NC}"
echo "   1. Prüfe mit: git status"
echo "   2. Teste mit: ./check-structure.sh"
echo ""
