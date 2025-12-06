"""
Receipts OCR Backend - PaddleOCR + PostgreSQL REST API

A Flask API for receipt OCR using PaddleOCR with PostgreSQL storage.
Based on patterns from Docker-OCR-2 llm_notes.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import subprocess
import sys
import tempfile
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
import psycopg2
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from paddleocr import PaddleOCR
from psycopg2.extras import RealDictCursor

if TYPE_CHECKING:
    from psycopg2.extensions import connection

# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# OpenCV Image Preprocessing for OCR Enhancement
# -----------------------------------------------------------------------------


def preprocess_for_ocr(img: np.ndarray) -> np.ndarray:
    """
    Apply OpenCV preprocessing to improve OCR accuracy.

    Steps:
    1. Convert to grayscale
    2. Apply adaptive thresholding for better contrast
    3. Denoise while preserving edges
    4. Deskew if needed

    Args:
        img: BGR image from cv2.imdecode

    Returns:
        Preprocessed BGR image ready for OCR
    """
    # Convert to grayscale for processing
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Denoise while preserving edges
    denoised = cv2.fastNlMeansDenoising(gray, h=10, templateWindowSize=7, searchWindowSize=21)

    # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(denoised)

    # Detect and correct skew
    enhanced = deskew_image(enhanced)

    # Convert back to BGR for PaddleOCR (it expects color images)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def deskew_image(gray: np.ndarray, max_angle: float = 10.0) -> np.ndarray:
    """
    Detect and correct image skew using Hough transform.

    Args:
        gray: Grayscale image
        max_angle: Maximum skew angle to correct (degrees)

    Returns:
        Deskewed grayscale image
    """
    # Edge detection
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)

    # Detect lines using Hough transform
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100, minLineLength=100, maxLineGap=10)

    if lines is None or len(lines) < 3:
        return gray  # Not enough lines to determine skew

    # Calculate angles of detected lines
    # HoughLinesP returns numpy array of shape (N, 1, 4) containing [x1, y1, x2, y2]
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]  # type: ignore[misc]
        if x2 - x1 != 0:  # Avoid division by zero
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            # Only consider near-horizontal lines
            if abs(angle) < max_angle:
                angles.append(angle)

    if not angles:
        return gray

    # Use median angle to avoid outliers
    median_angle = float(np.median(angles))

    if abs(median_angle) < 0.5:  # Skip if nearly straight
        return gray

    # Rotate to correct skew
    h, w = gray.shape
    center = (w // 2, h // 2)
    rotation_matrix = cv2.getRotationMatrix2D(center, median_angle, 1.0)
    rotated = cv2.warpAffine(
        gray, rotation_matrix, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )

    logger.debug(f"Deskewed image by {median_angle:.2f} degrees")
    return rotated


# -----------------------------------------------------------------------------
# Layout Analysis - Column-First Algorithm (from Docker-OCR-2)
# -----------------------------------------------------------------------------
# This algorithm properly handles multi-column layouts by:
# 1. Detecting column boundaries using X-gap analysis
# 2. Assigning blocks to columns
# 3. Clustering blocks within columns into "cards" using Y-gap analysis
# 4. Building table where row N = Nth card from each column
# -----------------------------------------------------------------------------


def analyze_layout_column_first(
    blocks: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Column-first layout analysis for multi-column documents.

    This algorithm:
    1. Detects column boundaries using X-gap analysis
    2. Assigns each block to its column
    3. Clusters blocks within each column into "cards" using Y-gaps
    4. Builds table where row N = Nth card from each column

    Args:
        blocks: List of OCR blocks with _x, _y, _w, _h coordinates

    Returns:
        Layout analysis with table_rows, column_count, row_count, raw_text
    """
    if not blocks:
        return {
            "table_rows": [],
            "column_count": 0,
            "row_count": 0,
            "raw_text": "",
            "blocks": [],
        }

    # Calculate median dimensions for thresholds
    heights = [b["_h"] for b in blocks]
    widths = [b["_w"] for b in blocks]
    median_height = sorted(heights)[len(heights) // 2] if heights else 30
    median_width = sorted(widths)[len(widths) // 2] if widths else 100

    # STEP 1: Detect column boundaries using X-gap analysis
    all_x_starts = sorted({int(b["_x"]) for b in blocks})

    x_gaps: list[tuple[int, int]] = []
    for i in range(1, len(all_x_starts)):
        gap = all_x_starts[i] - all_x_starts[i - 1]
        x_gaps.append((gap, all_x_starts[i]))

    col_boundaries = [all_x_starts[0]] if all_x_starts else [0]

    if x_gaps:
        gap_values = sorted([g[0] for g in x_gaps], reverse=True)
        # Large gaps separate columns - use adaptive threshold
        gap_threshold = max(median_width * 1.5, 300)

        logger.debug(f"X gaps (largest 5): {gap_values[:5]}, threshold: {gap_threshold:.0f}px")

        for gap_size, x_pos in x_gaps:
            if gap_size >= gap_threshold:
                col_boundaries.append(x_pos)
        col_boundaries.sort()

    num_cols = len(col_boundaries)
    logger.debug(f"Column boundaries ({num_cols}): {col_boundaries}")

    # STEP 2: Assign each block to a column
    columns: dict[int, list[dict[str, Any]]] = {i: [] for i in range(num_cols)}
    for block in blocks:
        block_x = block["_x"]
        col_idx = 0
        for i, col_x in enumerate(col_boundaries):
            if block_x >= col_x - 50:  # Allow some tolerance
                col_idx = i
        columns[col_idx].append(block)

    logger.debug(f"Blocks per column: {[len(columns[i]) for i in range(num_cols)]}")

    # STEP 3: Cluster blocks within each column into cards using Y-gaps
    y_gap_threshold = median_height * 1.2

    def cluster_column_blocks(col_blocks: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        """Cluster text blocks within a column into separate cards."""
        if not col_blocks:
            return []

        sorted_blocks = sorted(col_blocks, key=lambda b: b["_y"])
        y_positions = [(b["_y"], b["_y"] + b["_h"], b) for b in sorted_blocks]

        cards: list[list[dict[str, Any]]] = []
        current_card: list[dict[str, Any]] = [y_positions[0][2]]
        current_y_max = y_positions[0][1]

        for y_min, y_max, block in y_positions[1:]:
            gap = y_min - current_y_max
            if gap >= y_gap_threshold:
                # New card - significant vertical gap
                cards.append(current_card)
                current_card = [block]
                current_y_max = y_max
            else:
                # Same card
                current_card.append(block)
                current_y_max = max(current_y_max, y_max)

        if current_card:
            cards.append(current_card)

        return cards

    column_cards: dict[int, list[list[dict[str, Any]]]] = {}
    max_cards_per_col = 0
    for col_idx in range(num_cols):
        cards = cluster_column_blocks(columns[col_idx])
        column_cards[col_idx] = cards
        max_cards_per_col = max(max_cards_per_col, len(cards))

    logger.debug(f"Cards per column: {[len(column_cards[i]) for i in range(num_cols)]}")

    num_rows = max_cards_per_col
    logger.info(f"Layout: {num_cols} columns x {num_rows} rows")

    # STEP 4: Build table - each row is the Nth card from each column
    table_rows: list[dict[str, Any]] = []
    result_blocks: list[dict[str, Any]] = []
    extracted_lines: list[str] = []

    for row_idx in range(num_rows):
        row_cells: list[str] = [""] * num_cols
        row_confidences: list[float] = [0.0] * num_cols

        for col_idx in range(num_cols):
            cards = column_cards[col_idx]
            if row_idx < len(cards):
                card_blocks = cards[row_idx]
                # Sort blocks within card by Y then X for reading order
                sorted_card = sorted(card_blocks, key=lambda b: (b["_y"], b["_x"]))
                raw_card_text = " ".join([b["text"] for b in sorted_card])
                # Apply OCR text cleaning
                card_text = clean_ocr_text(raw_card_text)
                card_conf = max([b["confidence"] for b in sorted_card]) if sorted_card else 0.0
                row_cells[col_idx] = card_text
                row_confidences[col_idx] = card_conf

        table_rows.append({"row": row_idx, "cells": row_cells, "confidences": row_confidences})

        # Add to result blocks with row/col info
        for col_idx, cell_text in enumerate(row_cells):
            if cell_text:
                result_blocks.append(
                    {
                        "text": cell_text,
                        "confidence": row_confidences[col_idx],
                        "row": row_idx,
                        "col": col_idx,
                        "_x": 0,
                        "_y": row_idx * 50,
                        "_w": 200,
                        "_h": 40,
                    }
                )

        # Build text line (tab-separated for multi-column)
        row_text = "\t".join(row_cells)
        if row_text.strip():
            extracted_lines.append(row_text)

    raw_text = "\n".join(extracted_lines)

    return {
        "table_rows": table_rows,
        "column_count": num_cols,
        "row_count": num_rows,
        "raw_text": raw_text,
        "blocks": result_blocks,
    }


# Configuration
# -----------------------------------------------------------------------------
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB max file size
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tiff", "tif"}

# PostgreSQL configuration - use environment variables
DB_CONFIG = {
    "host": os.environ.get("POSTGRES_HOST", "localhost"),
    "port": os.environ.get("POSTGRES_PORT", "5432"),
    "database": os.environ.get("POSTGRES_DB", "receipts_ocr"),
    "user": os.environ.get("POSTGRES_USER", "postgres"),
    "password": os.environ.get("POSTGRES_PASSWORD", "postgres"),
}

# Configure logging - use stderr so gunicorn captures it with --capture-output
handler = logging.StreamHandler(sys.stderr)
handler.setLevel(logging.INFO)
handler.setFormatter(
    logging.Formatter("[%(asctime)s] [%(levelname)7s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
logger.addHandler(handler)
logger.propagate = False

# -----------------------------------------------------------------------------
# Flask Application Setup
# -----------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

# CORS: Allow all origins for development
CORS(
    app,
    resources={
        r"/*": {
            "origins": "*",
            "methods": ["GET", "POST", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Accept", "X-Requested-With"],
        }
    },
)

# -----------------------------------------------------------------------------
# Receipt-specific OCR Text Cleaning
# -----------------------------------------------------------------------------
# Based on patterns from llm_notes/technologies_used.md
OCR_CORRECTIONS = {
    # Common receipt OCR errors
    "Subtotai": "Subtotal",
    "Totai": "Total",
    "ltem": "Item",
    "ltems": "Items",
    "Qty": "Qty",
    "QTy": "Qty",
    "QTY": "Qty",
    "Prlce": "Price",
    "Arnount": "Amount",
    "TAx": "Tax",
    "TaX": "Tax",
    "$0.00": "$0.00",  # Keep as-is
}

# Regex patterns for price extraction
PRICE_PATTERN = re.compile(r"\$?\d+[.,]\d{2}")
QTY_PATTERN = re.compile(r"^\d+\s*[xX@]\s*")
PATTERN_AMPERSAND = re.compile(r"(\w)&(\w)")

# Regex-based corrections for spacing issues
REGEX_CORRECTIONS: list[tuple[re.Pattern[str], str]] = [
    # Number followed by common words without space
    (re.compile(r"(\d)(Items?)\b", re.IGNORECASE), r"\1 \2"),
    (re.compile(r"(\d)(Units?)\b", re.IGNORECASE), r"\1 \2"),
    # Closing paren followed by capital letter without space
    (re.compile(r"\)([A-Z][a-z]{2,})"), r") \1"),
    # Lowercase followed by common words without space
    (re.compile(r"([a-z])(Total)\b", re.IGNORECASE), r"\1 \2"),
    (re.compile(r"([a-z])(Subtotal)\b", re.IGNORECASE), r"\1 \2"),
    (re.compile(r"([a-z])(Tax)\b", re.IGNORECASE), r"\1 \2"),
]


# Price pattern: matches $12.34, 12.34, etc.
PRICE_PATTERN = re.compile(r"\$?\d+\.\d{2}")


def clean_ocr_text(text: str) -> str:
    """Apply OCR text cleaning based on llm_notes patterns."""
    if not text:
        return text
    cleaned = text

    # Step 1: Dictionary-based corrections
    for wrong, correct in OCR_CORRECTIONS.items():
        if wrong in cleaned:
            cleaned = cleaned.replace(wrong, correct)

    # Step 2: Regex-based corrections for spacing
    for pattern, replacement in REGEX_CORRECTIONS:
        cleaned = pattern.sub(replacement, cleaned)

    # Step 3: Fix ampersand spacing: "word&word" -> "word & word"
    cleaned = PATTERN_AMPERSAND.sub(r"\1 & \2", cleaned)

    # Step 4: Normalize multiple spaces
    cleaned = re.sub(r" {2,}", " ", cleaned)
    return cleaned.strip()


def extract_price(text: str) -> float | None:
    """Extract price from text string."""
    match = PRICE_PATTERN.search(text)
    if match:
        price_str = match.group().replace("$", "").replace(",", "")
        try:
            return float(price_str)
        except ValueError:
            return None
    return None


# -----------------------------------------------------------------------------
# Database Functions
# -----------------------------------------------------------------------------
def get_db_connection() -> connection | None:
    """Get PostgreSQL connection."""
    try:
        conn = psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)  # type: ignore[call-overload]
        return conn
    except psycopg2.Error as e:
        logger.error(f"Database connection failed: {e}")
        return None


def init_database() -> bool:
    """Initialize database tables."""
    conn = get_db_connection()
    if not conn:
        logger.warning("Could not connect to PostgreSQL - database features disabled")
        return False

    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS receipts (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255),
                    store_name VARCHAR(255),
                    receipt_date DATE,
                    subtotal DECIMAL(10,2),
                    tax DECIMAL(10,2),
                    total DECIMAL(10,2),
                    raw_text TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS receipt_items (
                    id SERIAL PRIMARY KEY,
                    receipt_id INTEGER REFERENCES receipts(id) ON DELETE CASCADE,
                    item_name VARCHAR(255),
                    quantity INTEGER DEFAULT 1,
                    unit_price DECIMAL(10,2),
                    total_price DECIMAL(10,2)
                );
            """)
            conn.commit()
        logger.info("Database tables initialized successfully")
        return True
    except psycopg2.Error as e:
        logger.error(f"Database initialization failed: {e}")
        return False
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# PaddleOCR Engine - based on llm_notes/technologies_used.md
# -----------------------------------------------------------------------------
def init_ocr_engine() -> PaddleOCR | None:
    """Initialize PaddleOCR with CPU-optimized settings."""
    try:
        # New PaddleOCR API (v3+)
        engine = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=False,  # Rotation handled elsewhere
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_det_limit_side_len=2560,
            text_det_limit_type="max",
            text_det_thresh=0.3,
            text_det_box_thresh=0.5,
        )
        logger.info("PaddleOCR initialized successfully")
        return engine
    except Exception as e:
        logger.exception(f"Failed to initialize PaddleOCR: {e}")
        return None


ocr = init_ocr_engine()


# -----------------------------------------------------------------------------
# Receipt Parsing Logic
# -----------------------------------------------------------------------------
def parse_receipt_text(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Parse OCR blocks into structured receipt data."""
    items: list[dict[str, Any]] = []
    subtotal: float | None = None
    tax: float | None = None
    total: float | None = None
    store_name: str | None = None

    # Sort blocks by Y position (top to bottom)
    sorted_blocks = sorted(blocks, key=lambda b: b.get("_y", 0))

    # First non-empty block is often the store name
    for block in sorted_blocks[:3]:
        text = block.get("text", "").strip()
        if text and not PRICE_PATTERN.search(text):
            store_name = clean_ocr_text(text)
            break

    # Keywords to exclude from items
    exclude_keywords = ["subtotal", "tax", "total", "change", "cash", "card", "credit", "debit"]

    for block in sorted_blocks:
        text = clean_ocr_text(block.get("text", ""))
        text_lower = text.lower()
        price = extract_price(text)

        # Detect totals
        if "subtotal" in text_lower and price:
            subtotal = price
        elif "tax" in text_lower and price:
            tax = price
        elif "total" in text_lower and "subtotal" not in text_lower and price:
            total = price
        elif price and text and not any(x in text_lower for x in exclude_keywords):
            # This is likely an item
            # Remove price from text to get item name
            item_name = PRICE_PATTERN.sub("", text).strip()
            if item_name:
                items.append(
                    {"name": item_name, "quantity": 1, "unit_price": price, "total_price": price}
                )

    return {
        "store_name": store_name,
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "total": total,
    }


# -----------------------------------------------------------------------------
# API Routes
# -----------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health() -> Response:
    """Health check endpoint."""
    db_status = "connected" if get_db_connection() else "disconnected"
    return jsonify(
        {
            "status": "healthy",
            "ocr_engine": "ready" if ocr else "not_initialized",
            "database": db_status,
        }
    )


@app.route("/ocr", methods=["POST"])
def ocr_endpoint() -> tuple[Response, int] | Response:
    """Process receipt image and return OCR results."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file or file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not ocr:
        return jsonify({"error": "OCR engine not initialized"}), 503

    try:
        # Read image
        file_bytes = file.read()
        nparr = np.frombuffer(file_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return jsonify({"error": "Invalid image file"}), 400

        logger.info(f"Processing receipt: {file.filename} ({len(file_bytes)} bytes)")

        # Preprocess image with OpenCV for better OCR accuracy
        preprocessed = preprocess_for_ocr(img)
        logger.info("Applied OpenCV preprocessing (denoise, CLAHE, deskew)")

        # Run OCR on preprocessed image (new PaddleOCR v3+ API)
        result = ocr.predict(preprocessed)

        if not result or len(result) == 0:
            return jsonify({"error": "No text detected"}), 200

        # New API returns list of dicts with 'rec_texts', 'rec_scores', 'dt_polys'
        ocr_result = result[0]
        rec_texts = ocr_result.get("rec_texts", [])
        rec_scores = ocr_result.get("rec_scores", [])
        dt_polys = ocr_result.get("dt_polys", [])

        if not rec_texts:
            return jsonify({"error": "No text detected"}), 200

        logger.info(f"Detected {len(rec_texts)} text blocks")

        # Extract blocks with coordinates
        blocks = []
        raw_lines = []

        for i, text in enumerate(rec_texts):
            confidence = rec_scores[i] if i < len(rec_scores) else 0.0
            bbox = dt_polys[i] if i < len(dt_polys) else [[0, 0], [0, 0], [0, 0], [0, 0]]

            x_coords = [p[0] for p in bbox]
            y_coords = [p[1] for p in bbox]

            blocks.append(
                {
                    "text": text,
                    "confidence": float(confidence),
                    "_x": float(min(x_coords)),
                    "_y": float(min(y_coords)),
                    "_w": float(max(x_coords) - min(x_coords)),
                    "_h": float(max(y_coords) - min(y_coords)),
                }
            )
            raw_lines.append(text)

        # Analyze layout - detect columns, rows, spacing
        layout = analyze_layout_column_first(blocks)
        logger.info(f"Layout: {layout['column_count']} columns, {layout['row_count']} rows")

        # Use layout-aware text reconstruction if multi-column
        raw_text = layout["raw_text"] if layout["column_count"] > 1 else "\n".join(raw_lines)

        # Parse receipt structure
        parsed = parse_receipt_text(blocks)

        return jsonify(
            {
                "success": True,
                "filename": file.filename,
                "blocks": blocks,
                "raw_text": raw_text,
                "parsed": parsed,
                "layout": {
                    "column_count": layout["column_count"],
                    "row_count": layout["row_count"],
                },
            }
        )

    except Exception as e:
        logger.exception(f"OCR processing failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/detect-rotation", methods=["POST"])
def detect_rotation() -> tuple[Response, int] | Response:
    """
    Detect image orientation using Tesseract OSD.

    Request: JSON with 'image' field containing base64-encoded image data
    Response: JSON with orientation, confidence, and correction angle
    """
    try:
        logger.info("Rotation detection request received")

        data = request.get_json()
        if not data or "image" not in data:
            return jsonify({"error": "No image data provided"}), 400

        # Extract base64 image data
        image_data = data["image"]

        # Remove data URL prefix if present
        if "," in image_data:
            image_data = image_data.split(",")[1]

        # Decode base64
        img_bytes = base64.b64decode(image_data)
        logger.info(f"Decoded {len(img_bytes)} bytes for rotation detection")

        # Save to temporary file for Tesseract
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(img_bytes)
            tmp_path = tmp.name

        try:
            # Run Tesseract OSD (Orientation and Script Detection)
            logger.info("Running Tesseract OSD...")
            result = subprocess.run(
                ["tesseract", tmp_path, "stdout", "--psm", "0"],
                capture_output=True,
                text=True,
                timeout=30,
            )

            osd_output = result.stdout
            logger.info(f"Tesseract OSD output: {osd_output[:200] if osd_output else 'empty'}")

            # Parse orientation from OSD output
            orientation = 0
            rotate = 0
            confidence = 0.0
            script = "Unknown"

            for line in osd_output.split("\n"):
                if "Orientation in degrees:" in line:
                    orientation = int(line.split(":")[1].strip())
                elif "Rotate:" in line:
                    rotate = int(line.split(":")[1].strip())
                elif "Orientation confidence:" in line:
                    confidence = float(line.split(":")[1].strip())
                elif "Script:" in line:
                    script = line.split(":")[1].strip()

            logger.info(
                "Detected: orientation=%d°, rotate=%d°, confidence=%.2f",
                orientation,
                rotate,
                confidence,
            )

            return jsonify(
                {
                    "success": True,
                    "orientation": orientation,
                    "rotate": rotate,
                    "confidence": confidence,
                    "script": script,
                    "raw_output": osd_output,
                }
            )

        finally:
            # Clean up temp file
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)

    except subprocess.TimeoutExpired:
        logger.error("Tesseract OSD timed out")
        return jsonify({"error": "Tesseract OSD timed out"}), 500
    except FileNotFoundError:
        logger.error("Tesseract not installed")
        return jsonify(
            {
                "error": "Tesseract not installed in container",
                "success": False,
                "orientation": 0,
                "confidence": 0,
            }
        ), 503
    except Exception as e:
        logger.exception(f"Rotation detection failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/receipts", methods=["GET"])
def list_receipts() -> tuple[Response, int] | Response:
    """List all saved receipts."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database not available"}), 503

    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, filename, store_name, receipt_date, total, created_at
                FROM receipts ORDER BY created_at DESC
            """)
            receipts = cur.fetchall()
        return jsonify({"receipts": [dict(r) for r in receipts]})
    except psycopg2.Error as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/receipts", methods=["POST"])
def save_receipt() -> tuple[Response, int] | Response:
    """Save a receipt to the database."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database not available"}), 503

    try:
        with conn.cursor() as cur:
            # Insert receipt
            cur.execute(
                """
                INSERT INTO receipts (filename, store_name, subtotal, tax, total, raw_text)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING id
            """,
                (
                    data.get("filename"),
                    data.get("store_name"),
                    data.get("subtotal"),
                    data.get("tax"),
                    data.get("total"),
                    data.get("raw_text"),
                ),
            )
            row = cur.fetchone()
            if row is None:
                raise ValueError("Failed to insert receipt")
            receipt_id = row["id"]  # type: ignore[call-overload]

            # Insert items
            for item in data.get("items", []):
                cur.execute(
                    """
                    INSERT INTO receipt_items
                        (receipt_id, item_name, quantity, unit_price, total_price)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        receipt_id,
                        item.get("name"),
                        item.get("quantity", 1),
                        item.get("unit_price"),
                        item.get("total_price"),
                    ),
                )

            conn.commit()

        return jsonify({"success": True, "receipt_id": receipt_id})
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/receipts/<int:receipt_id>", methods=["GET"])
def get_receipt(receipt_id: int) -> tuple[Response, int] | Response:
    """Get a specific receipt with items."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database not available"}), 503

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM receipts WHERE id = %s", (receipt_id,))
            receipt = cur.fetchone()

            if not receipt:
                return jsonify({"error": "Receipt not found"}), 404

            cur.execute("SELECT * FROM receipt_items WHERE receipt_id = %s", (receipt_id,))
            items = cur.fetchall()

        result = dict(receipt)
        result["items"] = [dict(i) for i in items]
        return jsonify(result)
    except psycopg2.Error as e:
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


@app.route("/receipts/<int:receipt_id>", methods=["DELETE"])
def delete_receipt(receipt_id: int) -> tuple[Response, int] | Response:
    """Delete a receipt."""
    conn = get_db_connection()
    if not conn:
        return jsonify({"error": "Database not available"}), 503

    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM receipts WHERE id = %s RETURNING id", (receipt_id,))
            deleted = cur.fetchone()
            conn.commit()

        if not deleted:
            return jsonify({"error": "Receipt not found"}), 404

        return jsonify({"success": True})
    except psycopg2.Error as e:
        conn.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        conn.close()


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    init_database()
    app.run(host="0.0.0.0", port=5001, debug=True)
