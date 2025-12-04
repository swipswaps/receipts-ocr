# Receipts OCR

A full-stack receipt OCR application with PaddleOCR backend and React TypeScript frontend.

## Project History

This project was extracted from [Docker-OCR-2](https://github.com/swipswaps/Docker-OCR-2) as a standalone repository. During restoration from GitHub, various fixes that had been developed locally were lost and needed to be re-applied from chat logs.

### Current Status (December 2024)

✅ **All 11 quality gates pass**
✅ **All 10 Playwright tests pass**
✅ **Full feature parity with Docker-OCR-2**

### Features
- **PaddleOCR Backend** - High-accuracy OCR using PaddleOCR v2.9.1 with PostgreSQL storage
- **Text-based Rotation Detection** - Tesseract OSD for automatic orientation correction
- **HEIC/EXIF Support** - Automatic HEIC conversion and EXIF rotation handling
- **Output Tabs** - Export to Text, JSON, CSV, XLSX, SQL formats
- **Manual Rotation** - Rotate images CCW/CW before OCR
- **React TypeScript Frontend** - Modern UI with Vite, strict TypeScript, and ESLint
- **Receipt-specific OCR Cleaning** - Dictionary and regex-based corrections for common OCR errors

## Fixes Applied from chatLog.txt

### Backend (`backend/app.py`)
1. Added `/detect-rotation` endpoint using Tesseract OSD
2. Added `PATTERN_AMPERSAND` and `REGEX_CORRECTIONS` patterns
3. Enhanced `clean_ocr_text()` with multi-step cleaning:
   - Dictionary-based corrections
   - Regex-based spacing fixes
   - Ampersand spacing normalization
4. PaddleOCR settings: `use_angle_cls=False`, `det_limit_side_len=2560`

### Dockerfile
- Added `tesseract-ocr` and `tesseract-ocr-osd` packages

### Frontend (`src/services/ocrService.ts`)
- Added `detectTextOrientation()` function
- Exported `rotateImageCanvas` for manual rotation
- Updated `processWithDocker()` to detect orientation before OCR

### Frontend (`src/App.tsx`)
- Added output tabs (text, json, csv, xlsx, sql)
- Added manual rotation controls (CCW/CW buttons)
- Added useMemo hooks for format conversion
- Added download handlers for all formats

### Tests (`tests/receipts-ocr.spec.ts`)
- Updated selectors for new output tabs UI
- Fixed test image paths
- Fixed backend API response expectations

### CI/CD (`.github/workflows/quality.yml`)
- Fixed working directory for root-level frontend structure

## Quality Gates

| Tool | Purpose | Config |
|------|---------|--------|
| **trailing-whitespace** | Trim trailing whitespace | `.pre-commit-config.yaml` |
| **end-of-file-fixer** | Ensure files end with newline | `.pre-commit-config.yaml` |
| **check-yaml** | Validate YAML syntax | `.pre-commit-config.yaml` |
| **check-json** | Validate JSON syntax | `.pre-commit-config.yaml` |
| **check-added-large-files** | Prevent large file commits | `.pre-commit-config.yaml` |
| **detect-private-key** | Prevent key leaks | `.pre-commit-config.yaml` |
| **Ruff** v0.8.1 | Python linting + formatting | `backend/pyproject.toml` |
| **Mypy** v1.13.0 | Python type checking | `backend/pyproject.toml` |
| **ESLint** | TypeScript/JavaScript linting | `eslint.config.js` |
| **TypeScript** | Strict type checking | `tsconfig.*.json` |

## Development Setup

### Prerequisites
- Node.js 20+
- Python 3.12+
- Docker (optional)

### Quick Start

```bash
# Install dependencies
npm install
pip install -r backend/requirements.txt

# Install pre-commit hooks
pre-commit install

# Start frontend dev server
npm run dev

# Start backend (in separate terminal)
cd backend && python app.py

# Or use Docker Compose
docker-compose up -d
```

### Running Quality Checks

```bash
# Run all checks
pre-commit run --all-files

# Run Playwright tests
npx playwright test
```

## Best Practices & Next Steps

### Recommended Improvements
1. **SSE Log Streaming** - Add real-time backend logs to frontend
2. **Unit Tests** - Add Python unit tests for backend (`pytest`)
3. **Coverage Thresholds** - Enable 80% coverage requirement in CI
4. **Bundle Size Monitoring** - Track and optimize frontend bundle size
5. **Database Migrations** - Add Alembic for schema versioning

### Performance Optimization
- `det_limit_side_len=2560` balances quality and speed
- HEIC conversion uses 85% JPEG quality
- Lazy loading for heavy dependencies (xlsx)

## Architecture

```
receipts-ocr/
├── backend/
│   ├── app.py           # Flask API + PaddleOCR + rotation detection
│   ├── Dockerfile       # Backend container with Tesseract
│   ├── pyproject.toml   # Ruff/Mypy config
│   └── requirements.txt
├── src/
│   ├── App.tsx          # Main React component with output tabs
│   ├── App.css          # Styles for rotation controls, tabs
│   ├── types.ts         # TypeScript types including OutputTab
│   └── services/
│       └── ocrService.ts # API client + rotation detection
├── tests/
│   └── receipts-ocr.spec.ts # Playwright E2E tests
├── .github/
│   └── workflows/
│       └── quality.yml  # CI pipeline
├── .pre-commit-config.yaml
├── docker-compose.yml
├── eslint.config.js
├── playwright.config.ts
└── package.json
```

## License

MIT
