#!/bin/bash

# ============================================
# Projekt-Struktur-Checker für ioBroker.hueemu
# Findet problematische Dateien OHNE npm
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔍 Prüfe Projektstruktur...${NC}\n"

PROBLEMS=0

# ============================================
# 1. Backup/Alte Dateien
# ============================================
echo "1️⃣  Suche nach Backup/Alte Dateien..."
OLD_FILES=$(find . -type f \( -name "*.old" -o -name "*.backup" -o -name "*.bak" -o -name "*.tmp" -o -name "*.temp" -o -name "*~" \) -not -path "./node_modules/*" -not -path "./.git/*")

if [ -n "$OLD_FILES" ]; then
    echo -e "${RED}   ❌ Gefunden:${NC}"
    echo "$OLD_FILES" | sed 's/^/      /'
    PROBLEMS=$((PROBLEMS + 1))
else
    echo -e "${GREEN}   ✅ Keine gefunden${NC}"
fi
echo ""

# ============================================
# 2. macOS Duplikate
# ============================================
echo "2️⃣  Suche nach macOS Duplikaten..."
DUPES=$(find . -type f -name "* 2.*" -o -name "* 3.*" -o -name "*Kopie*" | grep -v node_modules | grep -v .git)

if [ -n "$DUPES" ]; then
    echo -e "${RED}   ❌ Gefunden:${NC}"
    echo "$DUPES" | sed 's/^/      /'
    PROBLEMS=$((PROBLEMS + 1))
else
    echo -e "${GREEN}   ✅ Keine gefunden${NC}"
fi
echo ""

# ============================================
# 3. Mehrere READMEs
# ============================================
echo "3️⃣  Suche nach mehreren READMEs..."
READMES=$(find . -maxdepth 1 -type f -iname "README*" | wc -l | tr -d ' ')

if [ "$READMES" -gt 1 ]; then
    echo -e "${RED}   ❌ $READMES README-Dateien gefunden:${NC}"
    find . -maxdepth 1 -type f -iname "README*" | sed 's/^/      /'
    PROBLEMS=$((PROBLEMS + 1))
else
    echo -e "${GREEN}   ✅ Nur eine README.md${NC}"
fi
echo ""

# ============================================
# 4. Fehlplatzierte Dateien im Root
# ============================================
echo "4️⃣  Suche nach fehlplatzierten Dateien im Root..."
MISPLACED=$(find . -maxdepth 1 -type f -name "src*" -o -name "test*" -o -name "docs*" -o -name "admin*" | grep -v "^\./src$" | grep -v "^\./test$" | grep -v "^\./docs$" | grep -v "^\./admin$")

if [ -n "$MISPLACED" ]; then
    echo -e "${RED}   ❌ Gefunden:${NC}"
    echo "$MISPLACED" | sed 's/^/      /'
    PROBLEMS=$((PROBLEMS + 1))
else
    echo -e "${GREEN}   ✅ Keine gefunden${NC}"
fi
echo ""

# ============================================
# 5. Experimentelle Dateien
# ============================================
echo "5️⃣  Suche nach experimentellen Dateien..."
EXPERIMENTAL=$(find . -type f \( -name "*-optimized.*" -o -name "*-experimental.*" -o -name "*-test.*" -o -name "*-neu.*" -o -name "*-alt.*" \) -not -path "./node_modules/*" -not -path "./.git/*")

if [ -n "$EXPERIMENTAL" ]; then
    echo -e "${RED}   ❌ Gefunden:${NC}"
    echo "$EXPERIMENTAL" | sed 's/^/      /'
    PROBLEMS=$((PROBLEMS + 1))
else
    echo -e "${GREEN}   ✅ Keine gefunden${NC}"
fi
echo ""

# ============================================
# Zusammenfassung
# ============================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $PROBLEMS -eq 0 ]; then
    echo -e "${GREEN}✅ Projektstruktur ist sauber!${NC}"
    exit 0
else
    echo -e "${RED}❌ $PROBLEMS Problem(e) gefunden!${NC}"
    echo ""
    echo -e "${YELLOW}💡 Zum Aufräumen:${NC}"
    echo "   ./cleanup-project.sh"
    exit 1
fi
