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

# Step 6: Install npm and start frontend
log_step "Step 6/6: Setting up frontend..."
if command -v npm &> /dev/null; then
    log_ok "npm found: $(npm --version)"
    echo "    Installing dependencies..."
    npm install --silent
    log_ok "Dependencies installed"

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    Setup Complete!                        ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "To start the app, run:"
    echo -e "  ${BLUE}npm run dev${NC}"
    echo ""
    echo "Then open: http://localhost:5173"
    echo ""
    read -p "Start the app now? [Y/n] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        npm run dev
    fi
else
    log_warn "npm not found - please install Node.js 20+ from https://nodejs.org"
    echo ""
    echo "After installing Node.js, run:"
    echo "  cd ${REPO_DIR}"
    echo "  npm install"
    echo "  npm run dev"
fi
