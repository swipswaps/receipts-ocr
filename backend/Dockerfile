# Receipts OCR Backend - Based on Docker-OCR-2 patterns
FROM python:3.9-slim

# System dependencies for OpenCV and PaddleOCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgomp1 \
    curl \
    tesseract-ocr \
    tesseract-ocr-osd \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash appuser

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download PaddleOCR models
RUN python -c 'from paddleocr import PaddleOCR; PaddleOCR(lang="en")'

# Copy application
COPY app.py .

# Change ownership to appuser
RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:5001/health || exit 1

# Production server with gunicorn
# Using threads=4 so the single worker can handle /logs requests during long OCR (Issue #27)
CMD ["gunicorn", \
     "--bind", "0.0.0.0:5001", \
     "--workers", "1", \
     "--threads", "4", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--log-level", "info", \
     "--access-logfile", "-", \
     "--error-logfile", "-", \
     "--capture-output", \
     "app:app"]
