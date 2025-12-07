# Receipts OCR

A production-ready document OCR application featuring PaddleOCR backend with column-first layout analysis, React TypeScript frontend, and comprehensive real-time logging. Originally designed for receipts, now generalized for any document type.

---

## 📍 Where We Are (December 2025)

| Metric | Status |
|--------|--------|
| **Quality Gates** | ✅ 11 pre-commit hooks pass |
| **CI/CD** | ✅ GitHub Actions deploy to Pages |
| **Issues Tracked** | 35 documented, 33 fixed |
| **Test Coverage** | Playwright E2E + Selenium tests |
| **Chat Logs Reviewed** | 7 logs (chatLog.txt through chatLog8.txt) |

### Live Demo & Usage Options

| Option | URL | Backend | OCR Engine | Accuracy |
|--------|-----|---------|------------|----------|
| **GitHub Pages + Local Docker** | [swipswaps.github.io/receipts-ocr](https://swipswaps.github.io/receipts-ocr/) | Your local Docker | PaddleOCR | ⭐⭐⭐⭐⭐ |
| **GitHub Pages (no Docker)** | Same URL | None | Tesseract.js fallback | ⭐⭐⭐ |
| **Local Development** | `http://localhost:5173` | Docker container | PaddleOCR | ⭐⭐⭐⭐⭐ |
| **LAN Access** | `http://192.168.x.x:5173` | Docker on host | PaddleOCR | ⭐⭐⭐⭐⭐ |

### Core Features
- **PaddleOCR v3+ Backend** - High-accuracy OCR with column-first layout analysis
- **Smart Block Grouping** - Groups text spatially into addresses, catalog items, tables
- **Text Orientation Detection** - Tesseract OSD auto-corrects rotated images
- **HEIC/EXIF Support** - Automatic conversion and rotation handling
- **5 Export Formats** - Text, JSON, CSV, XLSX, SQL
- **Real-time Backend Logs** - Streams actual Python logs to frontend during OCR (no fake spinners)
- **Self-healing Docker Status** - Auto-fallback to Tesseract.js when backend unavailable
- **Configurable Ports** - Set `VITE_PORT` and `BACKEND_PORT` via `.env` file
- **Firewall Lifecycle Management** - `start.sh`/`stop.sh` scripts manage ports and cleanup

---

## 🛤️ How We Got Here: The Evolution

### Phase 1: Origin (Docker-OCR-2)
This project was extracted from [Docker-OCR-2](https://github.com/swipswaps/Docker-OCR-2) as a standalone repository. The original goal was a simple receipt scanner, but it evolved into a general-purpose document OCR system.

### Phase 2: Restoration & Debugging (Issues #1-27)
During restoration from GitHub, locally-developed fixes were lost. Seven chat logs (`chatLog.txt` through `chatLog8.txt`, note: chatLog4.txt doesn't exist) document the extensive debugging sessions to rebuild the application.

**Key challenges solved:**
- PaddleOCR v3+ API breaking changes
- Frontend state management bugs (logs clearing, health check spam)
- HEIC preprocessing race conditions
- Multi-column text layout detection

### Phase 3: Production Hardening (Issues #28-35)
Recent work focused on deployment robustness:

| Issue | Problem | Solution |
|-------|---------|----------|
| #28 | Database 500 errors | `init_database()` called at module load |
| #29 | Columns read across rows | Adaptive gap detection (median × 3) |
| #30 | Modal crashes on click | Fixed field name mismatch (`total_amount` vs `total`) |
| #31 | Network blocked on LAN | Firewall detection + management scripts |
| #34 | Complex receipt schema | Simplified to single `scans` table |
| #35 | Port/process cleanup | `start.sh`/`stop.sh` with PID tracking |

### Phase 4: Code Quality (Current)
Consolidated configuration and eliminated repeated anti-patterns:
- Created `src/config.ts` with centralized `API_BASE` export
- All 5 services now use consistent backend URL detection
- GitHub Pages correctly uses `localhost:5001` for local Docker

---

## 🔮 What Options Are Available

### Deployment Options

| Method | Best For | Setup Effort |
|--------|----------|--------------|
| **GitHub Pages + Local Docker** | Daily use, best accuracy | Low - just run Docker |
| **Full Local Development** | Contributing, customizing | Medium |
| **LAN Sharing** | Scan from phone/tablet | Low - open firewall ports |
| **Docker Only** | API-only usage | Minimal |

### OCR Engine Comparison

| Engine | Accuracy | Speed | Requirements |
|--------|----------|-------|--------------|
| **PaddleOCR** | ⭐⭐⭐⭐⭐ Excellent | 60-90s/image | Docker (~2GB) |
| **Tesseract.js** | ⭐⭐⭐ Good | 10-30s/image | Browser only |

### Export Formats

| Format | Use Case |
|--------|----------|
| **Text** | Quick copy/paste |
| **JSON** | API integration |
| **CSV** | Spreadsheet import |
| **XLSX** | Excel with formatting |
| **SQL** | Database import |

---

## 📖 User Guide

### Quick Start (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/swipswaps/receipts-ocr.git
cd receipts-ocr

# 2. Start Docker backend (first run downloads ~2GB, takes 2-5 min)
docker compose up -d

# 3. Wait for PaddleOCR to initialize
docker logs -f receipts-ocr-backend
# Look for: "[INFO] PaddleOCR initialized successfully"
# Press Ctrl+C to exit logs

# 4. Open GitHub Pages in your browser
# https://swipswaps.github.io/receipts-ocr/
# OR run locally: npm install && npm run dev
```

### Using the Application

1. **Upload an image** - Drag & drop or click to browse (supports JPEG, PNG, HEIC)
2. **Wait for preprocessing** - HEIC conversion and rotation detection happen automatically
3. **Click "Extract Text"** - Watch real-time backend logs during OCR
4. **Review results** - Text appears in the output panel with layout preserved
5. **Export** - Choose from 5 formats (Text, JSON, CSV, XLSX, SQL)
6. **Save to Database** - Optional: store scans for later retrieval

### Accessing from Other Devices (LAN)

To scan from your phone or another computer on your network:

```bash
# Start with network access scripts
./scripts/start.sh

# Or manually:
# 1. Find your IP
ip addr | grep "192.168"  # Linux
ipconfig | findstr "192.168"  # Windows

# 2. Open firewall (Linux)
sudo firewall-cmd --add-port=5173/tcp --add-port=5001/tcp

# 3. Access from other device
# http://YOUR_IP:5173
```

### Using with GitHub Pages

The GitHub Pages demo at [swipswaps.github.io/receipts-ocr](https://swipswaps.github.io/receipts-ocr/) connects to YOUR local Docker backend:

1. **Start Docker on your machine**: `docker compose up -d`
2. **Open the GitHub Pages URL in your browser**
3. **The frontend (hosted on GitHub) connects to `localhost:5001` (your Docker)**

If Docker isn't running, it automatically falls back to Tesseract.js (less accurate but works anywhere).

---

## 🔧 Troubleshooting Guide

### Docker Issues

| Problem | Symptoms | Solution |
|---------|----------|----------|
| Docker not running | "Cannot connect to Docker daemon" | Start Docker Desktop (macOS/Windows) or `sudo systemctl start docker` (Linux) |
| Permission denied | "Got permission denied" | `sudo usermod -aG docker $USER` then log out/in |
| Port 5001 in use | "Address already in use" | `./scripts/stop.sh` or `sudo lsof -i :5001` to find process |
| PaddleOCR not ready | "not_initialized" in health check | Wait 60-90s on first run; check `docker logs receipts-ocr-backend` |
| Out of memory | Container killed (SIGKILL) | Increase Docker memory to 4GB+ in Docker Desktop settings |
| First run slow | Downloads taking forever | ~2GB download; check internet connection |

### Frontend Issues

| Problem | Symptoms | Solution |
|---------|----------|----------|
| Backend shows "unavailable" | Red status indicator | Ensure Docker is running: `docker compose ps` |
| Stuck on "Processing..." | No progress after 2+ minutes | Check `docker logs receipts-ocr-backend` for errors |
| HEIC not converting | "File format not supported" | Refresh page; check browser console for errors |
| Logs not appearing | Empty log panel | Backend SSE connection failed; restart Docker |
| Tesseract fallback only | "Using Tesseract.js fallback" | Docker not running or not accessible |

### Network/Firewall Issues

| Problem | Symptoms | Solution |
|---------|----------|----------|
| Works on localhost, not LAN | Other devices can't connect | Open firewall ports 5173 + 5001 |
| 172.x.x.x IPs shown | Docker bridge network IPs | Use 192.168.x.x (your real LAN IP) |
| Connection refused on LAN | Firewall blocking | See firewall commands below |

**Firewall Commands:**

```bash
# Linux (firewalld)
sudo firewall-cmd --add-port=5173/tcp --add-port=5001/tcp

# Linux (ufw)
sudo ufw allow 5173/tcp && sudo ufw allow 5001/tcp

# Windows (PowerShell Admin)
New-NetFirewallRule -DisplayName "Receipts OCR" -Direction Inbound -LocalPort 5173,5001 -Protocol TCP -Action Allow
```

### OCR Quality Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Garbage text output | Image rotated/upside down | Rotation detection should auto-fix; try re-uploading |
| Text from wrong columns | Complex multi-column layout | PaddleOCR uses adaptive column detection; results may vary |
| Missing text | Low contrast or small font | Try higher resolution image |
| Numbers stuck to words | Spacing not added | Backend adds spaces automatically; check raw output |

### Diagnostic Commands

```bash
# Check Docker status
docker compose ps
docker logs receipts-ocr-backend --tail 50

# Check health endpoint
curl http://localhost:5001/health | jq

# Check frontend connection
curl -I http://localhost:5173

# Check what's using a port
sudo lsof -i :5001
sudo lsof -i :5173

# Full diagnostic
./scripts/start.sh --port 5173  # Shows network info
```

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js 20+** - [nodejs.org](https://nodejs.org/)
- **Docker Desktop** - [docker.com/get-started](https://www.docker.com/get-started/)
- Python 3.12+ (optional, for local backend development only)

### One-Command Setup

```bash
# Linux/macOS
./scripts/setup.sh

# Windows PowerShell
.\scripts\setup.ps1
```

### Manual Setup

```bash
# Clone and start everything
git clone https://github.com/swipswaps/receipts-ocr.git
cd receipts-ocr

# Copy environment template (optional - for custom ports)
cp .env.example .env
# Edit .env to change VITE_PORT (default: 5173) or BACKEND_PORT (default: 5001)

# Start backend (first run downloads ~2GB PaddleOCR models, takes 2-5 min)
docker compose up -d

# Wait for PaddleOCR to initialize
docker logs -f receipts-ocr-backend
# Look for: "[INFO] PaddleOCR initialized successfully"
# Press Ctrl+C to exit logs

# Start frontend with network access
./scripts/start.sh
# Or without scripts: npm install && npm run dev

# Open http://localhost:5173
```

### Installing Docker

<details>
<summary><strong>🐧 Linux (Ubuntu/Debian/Fedora)</strong></summary>

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Fedora
sudo dnf install docker docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

</details>

<details>
<summary><strong>🍎 macOS</strong></summary>

1. Download [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)
2. Open the `.dmg` and drag Docker to Applications
3. Launch Docker Desktop and wait for it to start
4. Verify: `docker --version`

</details>

<details>
<summary><strong>🪟 Windows</strong></summary>

1. Enable WSL2: Run `wsl --install` in PowerShell (Admin)
2. Download [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
3. Run installer, ensure "Use WSL 2" is checked
4. Launch Docker Desktop
5. Verify in PowerShell: `docker --version`

</details>

### Port Configuration

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Available settings:
```bash
VITE_PORT=5173      # Frontend dev server port
BACKEND_PORT=5001   # Backend API port (also update docker-compose.yml)
```

### Quality Gates (11 checks)

```bash
# Install hooks
pre-commit install

# Run all checks
pre-commit run --all-files
```

| Category | Tools |
|----------|-------|
| **File hygiene** | trailing-whitespace, end-of-file-fixer, check-yaml, check-json |
| **Security** | check-added-large-files, detect-private-key |
| **Python** | Ruff v0.8.1 (lint+format), Mypy v1.13.0 (types) |
| **TypeScript** | ESLint, TypeScript strict mode |
| **Build** | Bundle size limit (2.5MB) |

---

## 📁 Architecture

```
receipts-ocr/
├── backend/
│   ├── app.py              # Flask API + PaddleOCR + layout analysis + log streaming
│   ├── Dockerfile          # Backend container with Tesseract OSD, gunicorn threading
│   └── pyproject.toml      # Ruff/Mypy config
├── src/
│   ├── App.tsx             # Main React component
│   ├── config.ts           # Centralized API_BASE configuration
│   ├── types.ts            # TypeScript types (OcrResponse, Scan)
│   ├── components/
│   │   ├── DockerStatus.tsx    # Health monitoring + setup instructions
│   │   ├── ScanDetailsModal.tsx # View saved scan details
│   │   └── TroubleshootingWizard.tsx # Diagnostic wizard
│   └── services/
│       ├── ocrService.ts       # PaddleOCR API client
│       ├── backendLogService.ts # SSE log streaming from backend
│       ├── dockerHealthService.ts # Health monitoring with pause during OCR
│       └── systemLogger.ts     # Network request interceptor
├── scripts/
│   ├── setup.sh / setup.ps1   # One-command setup
│   ├── start.sh               # Start with firewall management
│   └── stop.sh                # Clean stop with cleanup
├── .github/workflows/
│   ├── deploy.yml          # GitHub Pages deployment
│   └── quality.yml         # CI quality gates
├── project_issues.json     # Full issue audit trail (35 issues)
├── .env.example            # Port configuration template
└── docker-compose.yml
```

### Key Backend Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (ocr_engine, database status) |
| `/ocr` | POST | Process image, return text blocks + layout |
| `/detect-rotation` | POST | Tesseract OSD orientation detection |
| `/logs` | GET | Poll recent logs since timestamp |
| `/logs/stream` | GET | SSE endpoint for real-time log streaming |
| `/scans` | GET/POST | Scan CRUD with PostgreSQL |
| `/scans/<id>` | GET/DELETE | Individual scan operations |

---

## 📋 Issue Tracking

All 35 issues are documented in `project_issues.json` with:
- Symptom, root cause, and fix details
- Files modified
- Verification method (Selenium/Playwright/manual)
- Repeated patterns identified and addressed

To view the full audit trail:
```bash
# All issues
cat project_issues.json | jq '.issues[] | {id, title, status}'

# Summary
cat project_issues.json | jq '.summary'

# Repeated patterns
cat project_issues.json | jq '.repeated_patterns'
```

---

## 🎓 Lessons Learned

Key insights from 35 issues across 7 chat logs:

1. **Always restart dev server** - Vite caches aggressively; changes require restart
2. **Test in private/incognito** - Browser cache hides real issues
3. **Use Selenium for verification** - Manual testing is unreliable for async operations
4. **Log everything verbosely** - Silent failures are debugging nightmares
5. **Centralize configuration** - Inconsistent API_BASE caused multiple bugs
6. **Track state files** - PID files and firewall rules need cleanup on exit
7. **Document issues as JSON** - Structured tracking prevents regression

---

## 🚀 Performance Notes

- `text_det_limit_side_len=2560` - Balances quality/speed for 4K images
- HEIC conversion: 85% JPEG quality
- Large images: ~60-90 seconds OCR time on CPU
- Lazy loading for ExcelJS (~500KB)
- gunicorn with 4 threads allows `/logs` during OCR processing

---

## License

MIT
