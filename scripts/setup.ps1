# Receipts OCR - Interactive Setup Script for Windows
# Run this in PowerShell (Admin recommended)

$ErrorActionPreference = "Stop"

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "✗ $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║           Receipts OCR - Full Setup Script                ║" -ForegroundColor Green
Write-Host "║   High-accuracy PaddleOCR with real-time log streaming    ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# Step 1: Check Docker
Write-Step "Step 1/6: Checking Docker installation..."
try {
    $dockerVersion = docker --version
    Write-Ok "Docker found: $dockerVersion"
} catch {
    Write-Err "Docker not found!"
    Write-Host ""
    Write-Host "Please install Docker Desktop:"
    Write-Host "  1. Download from https://docker.com/products/docker-desktop"
    Write-Host "  2. Run the installer (enable WSL2 if prompted)"
    Write-Host "  3. Start Docker Desktop"
    Write-Host "  4. Re-run this script"
    exit 1
}

# Step 2: Check Docker is running
Write-Step "Step 2/6: Checking Docker daemon..."
try {
    docker info | Out-Null
    Write-Ok "Docker daemon is running"
} catch {
    Write-Err "Docker daemon is not running!"
    Write-Host "Please start Docker Desktop and try again."
    exit 1
}

# Step 3: Check/clone repo
Write-Step "Step 3/6: Checking repository..."
if ((Test-Path "docker-compose.yml") -and (Test-Path "backend/app.py")) {
    Write-Ok "Already in receipts-ocr directory"
    $repoDir = "."
} elseif (Test-Path "receipts-ocr") {
    Write-Ok "Found existing receipts-ocr directory"
    Set-Location receipts-ocr
    $repoDir = "receipts-ocr"
} else {
    Write-Warn "Cloning repository..."
    git clone https://github.com/swipswaps/receipts-ocr.git
    Set-Location receipts-ocr
    $repoDir = "receipts-ocr"
    Write-Ok "Repository cloned"
}

# Step 4: Start Docker containers
Write-Step "Step 4/6: Starting Docker containers (this may take 2-5 minutes on first run)..."
Write-Host "    Building PaddleOCR backend with PostgreSQL..."
docker compose up -d --build
Write-Ok "Containers started"

# Step 5: Wait for PaddleOCR
Write-Step "Step 5/6: Waiting for PaddleOCR to initialize..."
Write-Host "    (PaddleOCR downloads ~2GB of models on first run)"
$maxWait = 120
$waitCount = 0
while ($waitCount -lt $maxWait) {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:5001/health" -TimeoutSec 2
        if ($health.status -eq "healthy") {
            Write-Host ""
            Write-Ok "Backend is healthy!"
            $health | ConvertTo-Json
            break
        }
    } catch { }
    Write-Host -NoNewline "."
    Start-Sleep -Seconds 2
    $waitCount += 2
}

if ($waitCount -ge $maxWait) {
    Write-Err "Backend did not become healthy within ${maxWait}s"
    Write-Host "Check logs with: docker logs receipts-ocr-backend"
    exit 1
}

# Step 6: Install npm and start frontend
Write-Step "Step 6/6: Setting up frontend..."
try {
    $npmVersion = npm --version
    Write-Ok "npm found: $npmVersion"
    Write-Host "    Installing dependencies..."
    npm install --silent
    Write-Ok "Dependencies installed"

    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║                    Setup Complete!                        ║" -ForegroundColor Green
    Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "To start the app, run:"
    Write-Host "  npm run dev" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Then open: http://localhost:5173"
    Write-Host ""
    $reply = Read-Host "Start the app now? [Y/n]"
    if ($reply -eq "" -or $reply -match "^[Yy]") {
        npm run dev
    }
} catch {
    Write-Warn "npm not found - please install Node.js 20+ from https://nodejs.org"
    Write-Host ""
    Write-Host "After installing Node.js, run:"
    Write-Host "  cd $repoDir"
    Write-Host "  npm install"
    Write-Host "  npm run dev"
}
