#!/bin/bash
# Receipts OCR - Interactive Setup Script
# This script guides you through setting up the full PaddleOCR backend
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_step() { echo -e "\n${BLUE}==>${NC} $1"; }
log_ok() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           Receipts OCR - Full Setup Script                ║"
echo "║   High-accuracy PaddleOCR with real-time log streaming    ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Step 1: Check Docker
log_step "Step 1/6: Checking Docker installation..."
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    log_ok "Docker found: $DOCKER_VERSION"
else
    log_error "Docker not found!"
    echo ""
    echo "Please install Docker first:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "  macOS: Download from https://docker.com/products/docker-desktop"
    else
        echo "  Linux: curl -fsSL https://get.docker.com | sudo sh"
        echo "         sudo usermod -aG docker \$USER"
        echo "         (Log out and back in, then re-run this script)"
    fi
    exit 1
fi

# Check Docker is running
log_step "Step 2/6: Checking Docker daemon..."
if docker info &> /dev/null; then
    log_ok "Docker daemon is running"
else
    log_error "Docker daemon is not running!"
    echo "Please start Docker Desktop (macOS/Windows) or run: sudo systemctl start docker"
    exit 1
fi

# Step 3: Check/clone repo
log_step "Step 3/6: Checking repository..."
if [ -f "docker-compose.yml" ] && [ -f "backend/app.py" ]; then
    log_ok "Already in receipts-ocr directory"
    REPO_DIR="."
elif [ -d "receipts-ocr" ]; then
    log_ok "Found existing receipts-ocr directory"
    cd receipts-ocr
    REPO_DIR="receipts-ocr"
else
    log_warn "Cloning repository..."
    git clone https://github.com/swipswaps/receipts-ocr.git
    cd receipts-ocr
    REPO_DIR="receipts-ocr"
    log_ok "Repository cloned"
fi

# Step 4: Start Docker containers
log_step "Step 4/6: Starting Docker containers (this may take 2-5 minutes on first run)..."
echo "    Building PaddleOCR backend with PostgreSQL..."
docker compose up -d --build 2>&1 | while read line; do
    echo "    $line"
done
log_ok "Containers started"

# Step 5: Wait for PaddleOCR to initialize
log_step "Step 5/6: Waiting for PaddleOCR to initialize..."
echo "    (PaddleOCR downloads ~2GB of models on first run)"
MAX_WAIT=120
WAIT_COUNT=0
while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if curl -s http://localhost:5001/health | grep -q '"status":"healthy"'; then
        echo ""
        log_ok "Backend is healthy!"
        curl -s http://localhost:5001/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:5001/health
        break
    fi
    echo -n "."
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))
done

if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
    log_error "Backend did not become healthy within ${MAX_WAIT}s"
    echo "Check logs with: docker logs receipts-ocr-backend"
    exit 1
fi

# Step 6: Install npm dependencies
log_step "Step 6/7: Setting up frontend..."
if command -v npm &> /dev/null; then
    log_ok "npm found: $(npm --version)"
    echo "    Installing dependencies..."
    npm install --silent
    log_ok "Dependencies installed"
else
    log_warn "npm not found - please install Node.js 20+ from https://nodejs.org"
    echo ""
    echo "After installing Node.js, run:"
    echo "  cd ${REPO_DIR}"
    echo "  npm install"
    echo "  npm run dev"
    exit 0
fi

# Step 7: Network access and firewall configuration (LAST STEP)
log_step "Step 7/7: Network Access Configuration"
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Setup Complete!                        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Get local IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "unknown")
FIREWALL_CONFIGURED=false

echo "Access the app:"
echo -e "  ${BLUE}Local:${NC}   http://localhost:5173"
if [ "$LOCAL_IP" != "unknown" ]; then
    echo -e "  ${BLUE}Network:${NC} http://${LOCAL_IP}:5173"
fi
echo ""

# Check and configure firewall
echo "Checking firewall for network access from other devices..."
echo ""

# Check for ufw (Ubuntu/Debian)
if command -v ufw &> /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "active"; then
        log_warn "ufw firewall is active"
        echo ""
        echo "    To access this app from phones/tablets/other computers,"
        echo "    ports 5173 (frontend) and 5001 (backend) must be opened."
        echo ""
        read -p "    Open firewall ports now? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            sudo ufw allow 5173/tcp comment "PaddleOCR frontend"
            sudo ufw allow 5001/tcp comment "PaddleOCR backend"
            log_ok "Firewall ports opened (5173, 5001)"
            FIREWALL_CONFIGURED=true
        else
            echo ""
            log_warn "Skipped. To enable network access later, run:"
            echo -e "    ${BLUE}sudo ufw allow 5173/tcp && sudo ufw allow 5001/tcp${NC}"
        fi
    else
        log_ok "ufw is inactive - no firewall blocking"
        FIREWALL_CONFIGURED=true
    fi
# Check for firewalld (Fedora/RHEL/CentOS)
elif command -v firewall-cmd &> /dev/null; then
    if systemctl is-active --quiet firewalld; then
        log_warn "firewalld is active"
        echo ""
        echo "    To access this app from phones/tablets/other computers,"
        echo "    ports 5173 (frontend) and 5001 (backend) must be opened."
        echo ""
        read -p "    Open firewall ports now? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            sudo firewall-cmd --add-port=5173/tcp --permanent
            sudo firewall-cmd --add-port=5001/tcp --permanent
            sudo firewall-cmd --reload
            log_ok "Firewall ports opened (5173, 5001)"
            FIREWALL_CONFIGURED=true
        else
            echo ""
            log_warn "Skipped. To enable network access later, run:"
            echo -e "    ${BLUE}sudo firewall-cmd --add-port=5173/tcp --add-port=5001/tcp --permanent${NC}"
            echo -e "    ${BLUE}sudo firewall-cmd --reload${NC}"
        fi
    else
        log_ok "firewalld is inactive - no firewall blocking"
        FIREWALL_CONFIGURED=true
    fi
# Check for iptables directly
elif command -v iptables &> /dev/null; then
    if sudo iptables -L INPUT -n 2>/dev/null | grep -qE "(DROP|REJECT)"; then
        log_warn "iptables has blocking rules"
        echo ""
        echo "    To enable network access, run:"
        echo -e "    ${BLUE}sudo iptables -I INPUT -p tcp --dport 5173 -j ACCEPT${NC}"
        echo -e "    ${BLUE}sudo iptables -I INPUT -p tcp --dport 5001 -j ACCEPT${NC}"
    else
        log_ok "No blocking iptables rules detected"
        FIREWALL_CONFIGURED=true
    fi
else
    log_ok "No firewall detected"
    FIREWALL_CONFIGURED=true
fi

echo ""
if [ "$FIREWALL_CONFIGURED" = true ] && [ "$LOCAL_IP" != "unknown" ]; then
    echo -e "${GREEN}✓ Network access ready: http://${LOCAL_IP}:5173${NC}"
fi
echo ""
echo "To start the app, run:"
echo -e "  ${BLUE}npm run dev${NC}"
echo ""
read -p "Start the app now? [Y/n] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
    npm run dev
fi
