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
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
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
# Layout Analysis - Column and Row Detection
# -----------------------------------------------------------------------------


def analyze_layout(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Analyze OCR blocks to detect columns, rows, and spacing.

    Args:
        blocks: List of OCR blocks with _x, _y, _w, _h coordinates

    Returns:
        Layout analysis with columns, rows, and grouped text
    """
    if not blocks:
        return {"columns": [], "rows": [], "grouped_text": []}

    # Sort blocks by Y coordinate (top to bottom)
    sorted_blocks = sorted(blocks, key=lambda b: b["_y"])

    # Detect rows by grouping blocks with similar Y coordinates
    rows = detect_rows(sorted_blocks)

    # Detect columns by analyzing X coordinates within rows
    columns = detect_columns(sorted_blocks)

    # Group text by detected structure
    grouped_text = group_by_layout(rows, columns)

    return {
        "columns": columns,
        "rows": rows,
        "grouped_text": grouped_text,
        "column_count": len(columns),
        "row_count": len(rows),
    }


def detect_rows(
    blocks: list[dict[str, Any]], y_tolerance: float = 0.5
) -> list[list[dict[str, Any]]]:
    """
    Group blocks into rows based on Y-coordinate proximity.

    Args:
        blocks: Sorted list of OCR blocks
        y_tolerance: Tolerance for Y-coordinate grouping (fraction of avg height)

    Returns:
        List of rows, each containing blocks on that row
    """
    if not blocks:
        return []

    # Calculate average block height for tolerance
    avg_height = sum(b["_h"] for b in blocks) / len(blocks)
    tolerance = avg_height * y_tolerance

    rows: list[list[dict[str, Any]]] = []
    current_row: list[dict[str, Any]] = [blocks[0]]
    current_y = blocks[0]["_y"]

    for block in blocks[1:]:
        # Check if block is on same row (within tolerance)
        if abs(block["_y"] - current_y) <= tolerance:
            current_row.append(block)
        else:
            # Start new row
            rows.append(sorted(current_row, key=lambda b: b["_x"]))  # Sort row by X
            current_row = [block]
            current_y = block["_y"]

    # Don't forget last row
    if current_row:
        rows.append(sorted(current_row, key=lambda b: b["_x"]))

    return rows


def detect_columns(
    blocks: list[dict[str, Any]], x_gap_threshold: float = 50.0
) -> list[dict[str, Any]]:
    """
    Detect column boundaries based on X-coordinate clustering.

    Args:
        blocks: List of OCR blocks
        x_gap_threshold: Minimum gap between columns in pixels

    Returns:
        List of column definitions with boundaries
    """
    if not blocks:
        return []

    # Get all X positions
    x_positions = [(b["_x"], b["_x"] + b["_w"]) for b in blocks]
    x_positions.sort(key=lambda p: p[0])

    # Find gaps that indicate column boundaries
    columns: list[dict[str, Any]] = []
    current_start = x_positions[0][0]
    current_end = x_positions[0][1]

    for start, end in x_positions[1:]:
        if start - current_end > x_gap_threshold:
            # Found a gap - save current column
            columns.append(
                {
                    "x_start": current_start,
                    "x_end": current_end,
                    "width": current_end - current_start,
                }
            )
            current_start = start
            current_end = end
        else:
            # Extend current column
            current_end = max(current_end, end)

    # Don't forget last column
    columns.append(
        {
            "x_start": current_start,
            "x_end": current_end,
            "width": current_end - current_start,
        }
    )

    return columns


def group_by_layout(
    rows: list[list[dict[str, Any]]], columns: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """
    Group text by layout structure for better output formatting.

    Args:
        rows: Detected rows from detect_rows()
        columns: Detected columns from detect_columns()

    Returns:
        List of grouped text entries with row/column info
    """
    grouped: list[dict[str, Any]] = []

    for row_idx, row in enumerate(rows):
        row_text_parts: list[str] = []

        for block in row:
            # Determine which column this block belongs to
            block_center = block["_x"] + block["_w"] / 2
            for i, col in enumerate(columns):
                if col["x_start"] <= block_center <= col["x_end"]:
                    _ = i  # Column index (unused but kept for potential future use)
                    break

            row_text_parts.append(block["text"])

        # Join row text with proper spacing
        if len(columns) > 1 and len(row_text_parts) > 1:
            # Multi-column: tab-separate
            row_text = "\t".join(row_text_parts)
        else:
            # Single column: space-separate
            row_text = " ".join(row_text_parts)

        grouped.append(
            {
                "row": row_idx,
                "text": row_text,
                "block_count": len(row),
            }
        )

    return grouped


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
        engine = PaddleOCR(
            use_angle_cls=False,  # Disabled - rotation handled elsewhere
            lang="en",
            use_gpu=False,
            show_log=False,
            enable_mkldnn=False,  # Disable MKL-DNN for CPU compatibility
            cpu_threads=1,
            use_tensorrt=False,
            use_mp=False,
            det_limit_side_len=2560,
            det_limit_type="max",
            det_db_thresh=0.3,
            det_db_box_thresh=0.5,
            rec_batch_num=6,
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

        # Run OCR on preprocessed image
        result = ocr.ocr(preprocessed, cls=False)

        if not result or not result[0]:
            return jsonify({"error": "No text detected"}), 200

        # Extract blocks with coordinates
        blocks = []
        raw_lines = []

        for line in result[0]:
            bbox, (text, confidence) = line
            x_coords = [p[0] for p in bbox]
            y_coords = [p[1] for p in bbox]

            blocks.append(
                {
                    "text": text,
                    "confidence": confidence,
                    "_x": min(x_coords),
                    "_y": min(y_coords),
                    "_w": max(x_coords) - min(x_coords),
                    "_h": max(y_coords) - min(y_coords),
                }
            )
            raw_lines.append(text)

        # Analyze layout - detect columns, rows, spacing
        layout = analyze_layout(blocks)
        logger.info(f"Layout: {layout['column_count']} columns, {layout['row_count']} rows")

        # Use layout-aware text reconstruction if multi-column
        if layout["column_count"] > 1:
            raw_text = "\n".join(g["text"] for g in layout["grouped_text"])
        else:
            raw_text = "\n".join(raw_lines)

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
