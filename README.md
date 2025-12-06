# Receipts OCR

A production-ready receipt OCR application featuring PaddleOCR backend with column-first layout analysis, React TypeScript frontend, and comprehensive logging.

## 📍 Where We Are (December 2025)

| Metric | Status |
|--------|--------|
| **Quality Gates** | ✅ 11 pre-commit hooks pass |
| **CI/CD** | ✅ GitHub Actions deploy to Pages |
| **Issues Tracked** | 25 documented, 23 fixed |
| **Test Coverage** | Playwright E2E + Selenium tests |

### Live Demo
- **GitHub Pages**: https://swipswaps.github.io/receipts-ocr/ (frontend-only, Tesseract.js fallback)
- **Full Features**: Run locally with Docker for PaddleOCR backend

### Core Features
- **PaddleOCR v3+ Backend** - High-accuracy OCR with column-first layout analysis
- **Smart Block Grouping** - Groups text spatially into addresses, catalog items, tables
- **Text Orientation Detection** - Tesseract OSD auto-corrects rotated images
- **HEIC/EXIF Support** - Automatic conversion and rotation handling
- **5 Export Formats** - Text, JSON, CSV, XLSX, SQL
- **Real-time System Logs** - Network requests, OCR progress, errors
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
| **High** | Server-Sent Events (SSE) | Real-time backend logs to frontend |
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
- Node.js 20+
- Docker & Docker Compose
- Python 3.12+ (for local backend development)

### Quick Start (Docker - Recommended)

```bash
# Clone and start everything
git clone https://github.com/swipswaps/receipts-ocr.git
cd receipts-ocr

# Start backend (wait ~60s for PaddleOCR to initialize)
docker compose up -d

# Start frontend
npm install
npm run dev

# Open http://localhost:5173
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
│   ├── app.py              # Flask API + PaddleOCR + layout analysis
│   ├── Dockerfile          # Backend container with Tesseract OSD
│   └── pyproject.toml      # Ruff/Mypy config
├── src/
│   ├── App.tsx             # Main React component
│   ├── types.ts            # TypeScript types (OcrResponse, TableRow)
│   ├── components/
│   │   └── DockerStatus.tsx # Health monitoring + GitHub Pages notice
│   └── services/
│       ├── ocrService.ts   # PaddleOCR API client
│       └── systemLogger.ts # Network request interceptor
├── .github/workflows/
│   ├── deploy.yml          # GitHub Pages deployment
│   └── quality.yml         # CI quality gates
├── project_issues.json     # Full issue audit trail (25 issues)
└── docker-compose.yml
```

### Key Backend Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (ocr_engine, database status) |
| `/ocr` | POST | Process image, return text blocks + layout |
| `/detect-rotation` | POST | Tesseract OSD orientation detection |
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
