# Receipts OCR

A production-ready receipt OCR application featuring PaddleOCR backend with column-first layout analysis, React TypeScript frontend, and comprehensive real-time logging.

## 📍 Where We Are (December 2025)

| Metric | Status |
|--------|--------|
| **Quality Gates** | ✅ 11 pre-commit hooks pass |
| **CI/CD** | ✅ GitHub Actions deploy to Pages |
| **Issues Tracked** | 27 documented, 25 fixed |
| **Test Coverage** | Playwright E2E + Selenium tests |

### Live Demo
- **GitHub Pages**: [swipswaps.github.io/receipts-ocr](https://swipswaps.github.io/receipts-ocr/) (frontend-only, Tesseract.js fallback)
- **Full Features**: Run locally with Docker for PaddleOCR backend (10x better accuracy)

### Core Features
- **PaddleOCR v3+ Backend** - High-accuracy OCR with column-first layout analysis
- **Smart Block Grouping** - Groups text spatially into addresses, catalog items, tables
- **Text Orientation Detection** - Tesseract OSD auto-corrects rotated images
- **HEIC/EXIF Support** - Automatic conversion and rotation handling
- **5 Export Formats** - Text, JSON, CSV, XLSX, SQL
- **Real-time Backend Logs** - Streams actual Python logs to frontend during OCR (no fake spinners)
- **Self-healing Docker Status** - Auto-fallback to Tesseract.js when backend unavailable

---

## 🛤️ How We Got Here

This project was extracted from [Docker-OCR-2](https://github.com/swipswaps/Docker-OCR-2) as a standalone repository. During restoration from GitHub, various fixes that had been developed locally were lost and needed to be re-applied from chat logs.

### The Journey (25 Issues Resolved)

The development process involved extensive debugging sessions documented in chat logs (`chatLog.txt` through `chatLog5.txt`). Key challenges and solutions:

#### Backend Issues (PaddleOCR)
| Issue | Symptom | Root Cause | Fix |
|-------|---------|------------|-----|
| **PaddleOCR v3+ API Change** | 503 error, "not_initialized" | Old params (`use_gpu`, `use_mp`) no longer valid | Updated to new API: `use_doc_orientation_classify`, `.predict()` |
| **Missing Rotation Detection** | Images upside down, garbage OCR | No endpoint for Tesseract OSD | Added `/detect-rotation` endpoint |
| **Text Lumped Together** | "CanadianSolar370-395w" | No spacing around numbers | Added `add_spaces_around_numbers()` post-processing |
| **Table Columns Misaligned** | Multi-column text concatenated | Fixed gap threshold | Column-first layout analysis with adaptive thresholds |

#### Frontend Issues
| Issue | Symptom | Root Cause | Fix |
|-------|---------|------------|-----|
| **Logs Disappearing** | All logs cleared on Extract | `setLogs([])` in `processReceipt()` | Removed - logs only clear on new file |
| **HEIC Race Condition** | 400 error, OCR before conversion | Button clickable during preprocessing | Added `isPreprocessing` state, disabled button |
| **Health Check Spam** | Thousands of checks/second | useEffect with `[onStatusChange]` dependency | Used `useRef` to start monitoring once |
| **Base64 Log Flooding** | Browser crash, memory spike | Logging full data: URLs (megabytes) | Skip `data:` URLs, truncate to 80 chars |
| **Empty Log Messages** | Logs show timestamp but no text | `systemLogger.info(message)` instead of `(category, message)` | Fixed all calls to include category |
| **Text Blocks Not Grouped** | Individual lines instead of paragraphs | Frontend used `data.blocks` not `data.raw_text` | Use backend's layout-analyzed `raw_text` |

#### CI/CD Issues
| Issue | Fix |
|-------|-----|
| **Mypy type errors** | Added `type: ignore[index]` for HoughLinesP, disabled `warn_unused_ignores` |
| **Bundle size exceeded** | Increased limit to 2.5MB (Tesseract.js + ExcelJS) |
| **GitHub Pages notice** | Detect `github.io` hostname, show frontend-only demo notice |

### Lessons Learned

1. **Always restart dev server** - Vite caches code; changes require restart
2. **Test in private/incognito** - Browser cache hides real issues
3. **Use Selenium for verification** - Manual testing is unreliable for async operations
4. **Log everything verbosely** - Silent failures are debugging nightmares
5. **Document issues as JSON** - See `project_issues.json` for full audit trail

---

## 🔮 Best Practices & Next Steps

### Recommended Improvements
| Priority | Improvement | Rationale |
|----------|-------------|-----------|
| ~~**High**~~ | ~~Server-Sent Events (SSE)~~ | ✅ **Done** - Real-time backend logs to frontend |
| **High** | Unit Tests (pytest) | Backend test coverage |
| **Medium** | 80% Coverage Threshold | Enforce in CI |
| **Medium** | Database Migrations | Alembic for schema versioning |
| **Low** | Bundle Size Monitoring | Track and optimize over time |

### Performance Notes
- `text_det_limit_side_len=2560` - Balances quality/speed for 4K images
- HEIC conversion: 85% JPEG quality
- Large images: ~60-90 seconds OCR time on CPU
- Lazy loading for ExcelJS (~500KB)

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js 20+** - [nodejs.org](https://nodejs.org/)
- **Docker Desktop** - [docker.com/get-started](https://www.docker.com/get-started/)
- Python 3.12+ (optional, for local backend development only)

### Quick Start (Docker - Recommended)

```bash
# Clone and start everything
git clone https://github.com/swipswaps/receipts-ocr.git
cd receipts-ocr

# Start backend (first run downloads ~2GB PaddleOCR models, takes 2-5 min)
docker compose up -d

# Wait for PaddleOCR to initialize (check with)
docker logs -f receipts-ocr-backend
# Look for: "[INFO] PaddleOCR initialized successfully"
# Press Ctrl+C to exit logs

# Start frontend
npm install
npm run dev

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

### Troubleshooting Docker

| Issue | Solution |
|-------|----------|
| `Cannot connect to Docker daemon` | Start Docker Desktop (macOS/Windows) or `sudo systemctl start docker` (Linux) |
| `Permission denied` | Run `sudo usermod -aG docker $USER` then log out/in |
| `Port 5001 in use` | Stop conflicting service or change port in `docker-compose.yml` |
| `PaddleOCR not initialized` | Wait 60-90s on first run; check `docker logs receipts-ocr-backend` |
| `Out of memory (SIGKILL)` | Increase Docker memory limit to 4GB+ in Docker Desktop settings |

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
│   ├── types.ts            # TypeScript types (OcrResponse, TableRow)
│   ├── components/
│   │   └── DockerStatus.tsx # Health monitoring + setup instructions + GitHub Pages notice
│   └── services/
│       ├── ocrService.ts       # PaddleOCR API client
│       ├── backendLogService.ts # SSE log streaming from backend
│       ├── dockerHealthService.ts # Health monitoring with pause during OCR
│       └── systemLogger.ts     # Network request interceptor
├── .github/workflows/
│   ├── deploy.yml          # GitHub Pages deployment
│   └── quality.yml         # CI quality gates
├── project_issues.json     # Full issue audit trail (27 issues)
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
| `/receipts` | GET/POST | Receipt CRUD with PostgreSQL |

---

## 📋 Issue Tracking

All issues are documented in `project_issues.json` with:
- Symptom, root cause, and fix details
- Files modified
- Verification method (Selenium/Playwright/manual)

To view the full audit trail:
```bash
cat project_issues.json | jq '.issues[] | {id, title, status}'
```

---

## License

MIT
