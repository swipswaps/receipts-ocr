#!/bin/bash
# Pre-start checks - runs automatically before npm run dev
# Checks Docker, ports, firewall and helps user fix issues

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_ok() { echo -e "  ${GREEN}✓${NC} $1"; }
log_warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
log_err() { echo -e "  ${RED}✗${NC} $1"; }

echo ""
echo -e "${BLUE}━━━ Pre-start checks ━━━${NC}"

# 1. Check if Docker backend is running
echo -n "  Backend container... "
if curl -s --max-time 2 http://localhost:5001/health > /dev/null 2>&1; then
    echo -e "${GREEN}running${NC}"
else
    echo -e "${RED}not running${NC}"
    echo ""
    echo -e "  ${YELLOW}Starting Docker containers...${NC}"
    docker compose up -d

    # Wait for backend to be healthy
    echo -n "  Waiting for backend"
    for i in {1..30}; do
        if curl -s --max-time 2 http://localhost:5001/health > /dev/null 2>&1; then
            echo -e " ${GREEN}ready${NC}"
            break
        fi
        echo -n "."
        sleep 1
    done

    if ! curl -s --max-time 2 http://localhost:5001/health > /dev/null 2>&1; then
        echo -e " ${RED}failed${NC}"
        echo ""
        log_err "Backend failed to start. Check: docker logs receipts-ocr-backend"
        exit 1
    fi
fi

# 2. Get local IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LOCAL_IP" ]; then
    LOCAL_IP="localhost"
fi

# 3. Check firewall status and offer to configure
FIREWALL_OK=true
FIREWALL_CHECKED=false

# Check firewalld FIRST (more common on Fedora/RHEL/Arch)
if command -v firewall-cmd &> /dev/null && systemctl is-active --quiet firewalld 2>/dev/null; then
    FIREWALL_CHECKED=true
    if ! firewall-cmd --list-ports 2>/dev/null | grep -q "5173"; then
        FIREWALL_OK=false
        echo ""
        log_warn "Firewall (firewalld) is blocking network access"
        echo ""
        echo "  Other devices won't be able to connect until ports are opened."
        echo "  Network URL: http://${LOCAL_IP}:5173"
        echo ""
        read -p "  Open firewall ports 5173 and 5001? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            sudo firewall-cmd --add-port=5173/tcp --permanent 2>/dev/null
            sudo firewall-cmd --add-port=5001/tcp --permanent 2>/dev/null
            sudo firewall-cmd --reload 2>/dev/null
            log_ok "Firewall configured"
            FIREWALL_OK=true
        else
            echo ""
            echo -e "  To enable later: ${BLUE}sudo firewall-cmd --add-port=5173/tcp --add-port=5001/tcp --permanent && sudo firewall-cmd --reload${NC}"
        fi
    fi
fi

# Check ufw (Ubuntu/Debian) only if firewalld wasn't active
if [ "$FIREWALL_CHECKED" = false ] && command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo -n ufw status 2>/dev/null | head -1 || ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "Status: active"; then
        FIREWALL_CHECKED=true
        # Check if ports are already allowed
        UFW_RULES=$(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null)
        if ! echo "$UFW_RULES" | grep -q "5173"; then
            FIREWALL_OK=false
            echo ""
            log_warn "Firewall (ufw) is blocking network access"
            echo ""
            echo "  Other devices won't be able to connect until ports are opened."
            echo "  Network URL: http://${LOCAL_IP}:5173"
            echo ""
            read -p "  Open firewall ports 5173 and 5001? [Y/n] " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
                sudo ufw allow 5173/tcp comment "PaddleOCR frontend" 2>/dev/null
                sudo ufw allow 5001/tcp comment "PaddleOCR backend" 2>/dev/null
                log_ok "Firewall configured"
                FIREWALL_OK=true
            else
                echo ""
                echo -e "  To enable later: ${BLUE}sudo ufw allow 5173/tcp && sudo ufw allow 5001/tcp${NC}"
            fi
        fi
    fi
fi

# 4. Show access URLs
echo ""
echo -e "${GREEN}━━━ Ready ━━━${NC}"
echo -e "  Local:   ${BLUE}http://localhost:5173${NC}"
if [ "$LOCAL_IP" != "localhost" ]; then
    echo -e "  Network: ${BLUE}http://${LOCAL_IP}:5173${NC}"
    if [ "$FIREWALL_OK" = true ]; then
        echo -e "           ${GREEN}✓ accessible from other devices${NC}"
    else
        echo -e "           ${YELLOW}⚠ firewall may block other devices${NC}"
    fi
fi
echo ""
