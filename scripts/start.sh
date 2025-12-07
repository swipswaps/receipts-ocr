#!/bin/bash
# Start the PaddleOCR app with proper firewall and process management
# Usage: ./scripts/start.sh [--port PORT]

set -e

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

# Load .env if exists
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Default ports (can be overridden by .env or command line)
VITE_PORT="${VITE_PORT:-5173}"
BACKEND_PORT="${BACKEND_PORT:-5001}"

# Parse command line args
while [[ $# -gt 0 ]]; do
    case $1 in
        --port) VITE_PORT="$2"; shift 2 ;;
        --backend-port) BACKEND_PORT="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo ""
echo -e "${BLUE}━━━ PaddleOCR App Start ━━━${NC}"
echo -e "  Frontend port: ${GREEN}$VITE_PORT${NC}"
echo -e "  Backend port:  ${GREEN}$BACKEND_PORT${NC}"

# Check if port is in use by ANOTHER process (not ours)
check_port_available() {
    local port=$1
    local pid_on_port=$(lsof -ti:$port 2>/dev/null | head -1)

    if [ -n "$pid_on_port" ]; then
        local proc_name=$(ps -p $pid_on_port -o comm= 2>/dev/null)
        # Only block if it's NOT our vite process
        if [ -f "$PID_FILE" ]; then
            local our_pid=$(cat "$PID_FILE")
            if [ "$pid_on_port" = "$our_pid" ]; then
                echo -e "  ${YELLOW}⚠${NC} Our previous instance still running (PID $our_pid)"
                echo -e "  Run ${BLUE}./scripts/stop.sh${NC} first, or use a different port"
                return 1
            fi
        fi
        echo -e "  ${RED}✗${NC} Port $port in use by: $proc_name (PID $pid_on_port)"
        echo -e "  Use ${BLUE}--port PORT${NC} to specify a different port"
        return 1
    fi
    return 0
}

# Add firewall rules
add_firewall_rules() {
    local added_rules=""

    if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld 2>/dev/null; then
        # firewalld
        if ! firewall-cmd --query-port=$VITE_PORT/tcp &>/dev/null; then
            sudo firewall-cmd --add-port=$VITE_PORT/tcp --permanent &>/dev/null
            added_rules="$added_rules firewalld:$VITE_PORT"
        fi
        if ! firewall-cmd --query-port=$BACKEND_PORT/tcp &>/dev/null; then
            sudo firewall-cmd --add-port=$BACKEND_PORT/tcp --permanent &>/dev/null
            added_rules="$added_rules firewalld:$BACKEND_PORT"
        fi
        if [ -n "$added_rules" ]; then
            sudo firewall-cmd --reload &>/dev/null
        fi
    elif command -v ufw &> /dev/null && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
        # ufw
        if ! sudo ufw status | grep -q "$VITE_PORT"; then
            sudo ufw allow $VITE_PORT/tcp comment "PaddleOCR frontend" &>/dev/null
            added_rules="$added_rules ufw:$VITE_PORT"
        fi
        if ! sudo ufw status | grep -q "$BACKEND_PORT"; then
            sudo ufw allow $BACKEND_PORT/tcp comment "PaddleOCR backend" &>/dev/null
            added_rules="$added_rules ufw:$BACKEND_PORT"
        fi
    fi

    # Save what we added so stop.sh can remove only those
    if [ -n "$added_rules" ]; then
        echo "$added_rules" > "$FIREWALL_STATE_FILE"
        echo -e "  ${GREEN}✓${NC} Firewall rules added"
    else
        echo -e "  ${GREEN}✓${NC} Firewall already configured"
    fi
}

# 1. Check port availability
echo ""
echo -n "  Checking port $VITE_PORT... "
if check_port_available $VITE_PORT; then
    echo -e "${GREEN}available${NC}"
else
    exit 1
fi

# 2. Start Docker backend if not running
echo -n "  Backend container... "
if curl -s --max-time 2 http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
    echo -e "${GREEN}running${NC}"
else
    echo -e "${YELLOW}starting${NC}"
    cd "$PROJECT_DIR" && docker compose up -d
    for i in {1..30}; do
        if curl -s --max-time 2 http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
fi

# 3. Configure firewall
add_firewall_rules

# 4. Start vite dev server
echo ""
echo -e "${GREEN}━━━ Starting Dev Server ━━━${NC}"
cd "$PROJECT_DIR"
VITE_PORT=$VITE_PORT npx vite --host --port $VITE_PORT --strictPort &
VITE_PID=$!
echo $VITE_PID > "$PID_FILE"

# Wait a moment then show URLs
sleep 2
# Get the real LAN IP (exclude Docker bridge IPs which start with 172.)
LOCAL_IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^172\.' | head -1)
echo ""
echo -e "  ${GREEN}✓${NC} Dev server running (PID: $VITE_PID)"
echo -e "  Local:   ${BLUE}http://localhost:$VITE_PORT${NC}"
echo -e "  Network: ${BLUE}http://$LOCAL_IP:$VITE_PORT${NC} (use this for other devices)"
echo ""
echo -e "  Stop with: ${BLUE}./scripts/stop.sh${NC}"
echo ""

# Wait for the process
wait $VITE_PID
