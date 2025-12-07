#!/bin/bash
# Stop the PaddleOCR app and clean up firewall rules
# Only kills processes WE started, only removes rules WE added

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.vite.pid"
FIREWALL_STATE_FILE="$PROJECT_DIR/.firewall-rules-added"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━ PaddleOCR App Stop ━━━${NC}"

# 1. Stop our vite process (only if we have the PID file)
if [ -f "$PID_FILE" ]; then
    VITE_PID=$(cat "$PID_FILE")
    if ps -p $VITE_PID > /dev/null 2>&1; then
        # Verify it's actually a vite/node process before killing
        PROC_CMD=$(ps -p $VITE_PID -o comm= 2>/dev/null)
        if [[ "$PROC_CMD" == "node" || "$PROC_CMD" == "vite" ]]; then
            kill $VITE_PID 2>/dev/null
            echo -e "  ${GREEN}✓${NC} Stopped vite dev server (PID: $VITE_PID)"
        else
            echo -e "  ${YELLOW}⚠${NC} PID $VITE_PID is not vite (is: $PROC_CMD), skipping"
        fi
    else
        echo -e "  ${YELLOW}⚠${NC} Vite process already stopped"
    fi
    rm -f "$PID_FILE"
else
    echo -e "  ${YELLOW}⚠${NC} No PID file found - was app started with ./scripts/start.sh?"
fi

# 2. Remove firewall rules that WE added (not pre-existing ones)
if [ -f "$FIREWALL_STATE_FILE" ]; then
    RULES_ADDED=$(cat "$FIREWALL_STATE_FILE")

    for rule in $RULES_ADDED; do
        FIREWALL_TYPE="${rule%%:*}"
        PORT="${rule##*:}"

        if [ "$FIREWALL_TYPE" = "firewalld" ]; then
            sudo firewall-cmd --remove-port=$PORT/tcp --permanent &>/dev/null
            echo -e "  ${GREEN}✓${NC} Removed firewalld rule for port $PORT"
        elif [ "$FIREWALL_TYPE" = "ufw" ]; then
            sudo ufw delete allow $PORT/tcp &>/dev/null
            echo -e "  ${GREEN}✓${NC} Removed ufw rule for port $PORT"
        fi
    done

    # Reload firewalld if we removed rules
    if echo "$RULES_ADDED" | grep -q "firewalld"; then
        sudo firewall-cmd --reload &>/dev/null
    fi

    rm -f "$FIREWALL_STATE_FILE"
else
    echo -e "  ${YELLOW}⚠${NC} No firewall state file - no rules to remove"
fi

# 3. Optionally stop Docker containers
echo ""
read -p "  Also stop Docker containers? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$PROJECT_DIR" && docker compose down
    echo -e "  ${GREEN}✓${NC} Docker containers stopped"
else
    echo -e "  ${BLUE}ℹ${NC} Docker containers left running"
fi

echo ""
echo -e "${GREEN}━━━ Cleanup Complete ━━━${NC}"
echo ""
