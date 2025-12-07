/**
 * OCR Service - Based on Docker-OCR-2 patterns from llm_notes
 */
import * as TesseractModule from 'tesseract.js';
import * as exifr from 'exifr';
import heic2any from 'heic2any';
import type { OcrResponse, ParsedReceipt } from '../types';
import { dockerHealthService } from './dockerHealthService';
import { backendLogService } from './backendLogService';
import { API_BASE } from '../config';

// Get createWorker from module (handles both default and named exports)
const createWorker = TesseractModule.createWorker;

type LogFn = (msg: string, level: 'info' | 'success' | 'warn' | 'error') => void;

/**
 * Check backend health
 */
export const checkBackendHealth = async (): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${API_BASE}/health`, {
      signal: controller.signal,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });

    clearTimeout(timeoutId);

    if (!response.ok) return false;
    const data = await response.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
};

/**
 * Preprocess image - handle HEIC and EXIF rotation
 * Based on llm_notes/mistakes_and_solutions.md
 */
export const preprocessImage = async (
  file: File,
  onLog?: LogFn
): Promise<File> => {
  let processedFile = file;
  const originalFile = file;

  // Check if HEIC - heic2any already applies EXIF rotation!
  let isHeicFile = file.name.toLowerCase().endsWith('.heic') || file.type === 'image/heic';

  if (isHeicFile) {
    onLog?.('Detected HEIC image, converting to JPEG...', 'info');
    try {
      const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
      const processedBlob = Array.isArray(blob) ? blob[0] : blob;
      processedFile = new File(
        [processedBlob],
        file.name.replace(/\.heic$/i, '.jpg'),
        { type: 'image/jpeg' }
      );
      onLog?.('HEIC converted (EXIF rotation applied by converter)', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      onLog?.(`HEIC conversion failed: ${msg}`, 'error');
      isHeicFile = false;
    }
  }

  // Apply EXIF rotation ONLY for non-HEIC files
  if (!isHeicFile) {
    try {
      const orientation = await exifr.orientation(originalFile);
      if (orientation && orientation !== 1) {
        let angle = 0;
        switch (orientation) {
          case 3: angle = 180; break;
          case 6: angle = 90; break;
          case 8: angle = 270; break;
        }
        if (angle !== 0) {
          onLog?.(`Applying EXIF rotation correction (${angle}°)...`, 'info');
          processedFile = await rotateImageCanvas(processedFile, angle);
          onLog?.('EXIF rotation applied', 'success');
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      onLog?.(`EXIF read skipped: ${msg}`, 'warn');
    }
  }

  return processedFile;
};

/**
 * Rotate image using canvas
 */
async function rotateImageCanvas(file: File, angle: number): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      if (angle === 90 || angle === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      canvas.toBlob((blob) => {
        resolve(new File([blob!], file.name, { type: file.type }));
      }, file.type);
    };
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Detect text orientation using backend Tesseract OSD
 * Returns the correction angle needed (0, 90, 180, or 270)
 */
export async function detectTextOrientation(
  file: File,
  onLog?: LogFn
): Promise<number> {
  try {
    onLog?.('Detecting text orientation...', 'info');

    // Convert file to base64
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    const response = await fetch(`${API_BASE}/detect-rotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 })
    });

    if (!response.ok) {
      onLog?.('OSD endpoint not available, skipping orientation detection', 'warn');
      return 0;
    }

    const data = await response.json();

    if (!data.success) {
      onLog?.(`OSD failed: ${data.error}`, 'warn');
      return 0;
    }

    // Calculate correction angle
    // OSD orientation: 0=upright, 90=rotated 90° CW, 180=upside down, 270=rotated 90° CCW
    // Correction: rotate the opposite direction
    let correctionAngle = 0;
    if (data.orientation === 90) {
      correctionAngle = 270; // Rotate 270° CW (or 90° CCW) to correct
    } else if (data.orientation === 180) {
      correctionAngle = 180;
    } else if (data.orientation === 270) {
      correctionAngle = 90; // Rotate 90° CW to correct
    }

    if (correctionAngle !== 0) {
      onLog?.(`Text orientation: ${data.orientation}°, applying ${correctionAngle}° correction`, 'info');
    } else {
      onLog?.('Text orientation: upright (no correction needed)', 'success');
    }

    return correctionAngle;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    onLog?.(`Orientation detection failed: ${msg}`, 'warn');
    return 0;
  }
}

// Export rotateImageCanvas for use in App.tsx manual rotation
export { rotateImageCanvas };

/**
 * Process receipt with Docker backend (PaddleOCR)
 */
export const processWithDocker = async (
  file: File,
  onLog?: LogFn
): Promise<OcrResponse> => {
  // Detect text orientation and apply correction if needed
  let processedFile = file;
  const correctionAngle = await detectTextOrientation(file, onLog);
  if (correctionAngle !== 0) {
    processedFile = await rotateImageCanvas(file, correctionAngle);
    onLog?.(`Applied ${correctionAngle}° text orientation correction`, 'success');
  }

  onLog?.('Sending to PaddleOCR backend...', 'info');

  const formData = new FormData();
  formData.append('file', processedFile);

  onLog?.('Waiting for PaddleOCR response...', 'info');

  // Pause health checks during OCR - backend is busy processing, not dead
  // This prevents false-negative health checks from switching to Tesseract fallback
  dockerHealthService.pauseMonitoring();

  // Start streaming backend logs to display real-time progress (Issue #27)
  // Subscribe to backend logs and forward them to the UI
  const unsubscribe = backendLogService.subscribe((log) => {
    // Map backend log levels to UI log levels
    const level = log.level === 'ERROR' ? 'error'
      : log.level === 'WARNING' ? 'warn'
      : 'info';
    onLog?.(`[Backend] ${log.message}`, level);
  });
  backendLogService.startStreaming();

  try {
    const response = await fetch(`${API_BASE}/ocr`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      onLog?.(`Backend error: ${response.status}`, 'error');
      throw new Error(`Backend error: ${response.status}`);
    }

    const data = await response.json();

    // Log detailed response info
    const blockCount = data.blocks?.length || 0;
    const tableRows = data.table_rows?.length || 0;
    const columns = data.column_count || 1;
    onLog?.(`OCR complete: ${blockCount} text blocks, ${columns} columns, ${tableRows} table rows`, 'success');

    // Use backend's layout-aware raw_text (groups text blocks spatially)
    // This preserves multi-line items like addresses and catalog entries
    const raw_text = data.raw_text || data.blocks?.map((b: { text: string }) => b.text).join('\n') || '';

    // Use backend's parsing (already done server-side) instead of re-parsing locally
    const parsed = data.parsed || parseReceiptText(raw_text.split('\n').filter((l: string) => l.trim()));

    return {
      success: true,
      filename: file.name,
      blocks: data.blocks || [],
      raw_text,
      parsed,
      table_rows: data.table_rows,
      column_count: data.column_count,
      row_count: data.row_count
    };
  } finally {
    // Stop streaming backend logs
    backendLogService.stopStreaming();
    unsubscribe();
    // Always resume health monitoring, even if OCR fails
    dockerHealthService.resumeMonitoring();
  }
};

/**
 * Simple OCR text parser (fallback if backend doesn't provide parsed data)
 * Captures all text lines as items, not just those with prices.
 */
function parseReceiptText(lines: string[]): ParsedReceipt {
  const items: { name: string; quantity: number; unit_price: number | null; total_price: number | null }[] = [];
  let subtotal = null;
  let tax = null;
  let total = null;
  let store_name = null;

  const pricePattern = /\$?\d+[.,]\d{2}/;
  const excludeKeywords = ['subtotal', 'tax', 'total', 'change', 'cash', 'card', 'credit', 'debit'];
  const MIN_ITEM_LENGTH = 3;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < MIN_ITEM_LENGTH) continue;

    const lower = trimmed.toLowerCase();
    const priceMatch = trimmed.match(pricePattern);
    const price = priceMatch ? parseFloat(priceMatch[0].replace('$', '').replace(',', '')) : null;

    // Skip metadata keywords
    if (excludeKeywords.some(x => lower.includes(x))) {
      if (lower.includes('subtotal') && price) subtotal = price;
      else if (lower.includes('tax') && price) tax = price;
      else if (lower.includes('total') && price) total = price;
      continue;
    }

    // Capture as item - with or without price
    const name = trimmed.replace(pricePattern, '').trim();
    if (name && name.length >= MIN_ITEM_LENGTH) {
      items.push({ name, quantity: 1, unit_price: price, total_price: price });
    }
  }

  // Use first item as store_name if available
  if (items.length > 0) {
    store_name = items[0].name;
  }

  return { store_name, items, subtotal, tax, total };
}

// ============================================================================
// Database API functions - Simplified scan storage
// ============================================================================

/**
 * Scan type - simple storage of OCR results
 */
export interface Scan {
  id: number;
  filename: string;
  raw_text: string;
  created_at: string;
}

/**
 * List all scans from database
 */
export const listScans = async (): Promise<Scan[]> => {
  const response = await fetch(`${API_BASE}/scans`);
  if (!response.ok) throw new Error('Failed to fetch scans');
  const data = await response.json();
  return data.scans || [];
};

/**
 * Get single scan
 */
export const getScan = async (id: number): Promise<Scan> => {
  const response = await fetch(`${API_BASE}/scans/${id}`);
  if (!response.ok) throw new Error('Scan not found');
  return response.json();
};

/**
 * Save scan to database
 */
export const saveScan = async (
  filename: string,
  raw_text: string
): Promise<{ scan_id: number }> => {
  const response = await fetch(`${API_BASE}/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, raw_text })
  });

  if (!response.ok) throw new Error('Failed to save scan');
  return response.json();
};

/**
 * Delete scan from database
 */
export const deleteScan = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/scans/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to delete scan');
};

/**
 * Clear all scans from database
 */
export const clearAllScans = async (): Promise<{ deleted_count: number }> => {
  const response = await fetch(`${API_BASE}/scans/clear`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Failed to clear scans');
  return response.json();
};

/**
 * Database stats response type
 */
export interface DatabaseStats {
  scan_count: number;
  oldest_scan: string | null;
  newest_scan: string | null;
  database: string;
  status: string;
}

/**
 * Get database statistics
 */
export const getDatabaseStats = async (): Promise<DatabaseStats> => {
  const response = await fetch(`${API_BASE}/stats`);
  if (!response.ok) throw new Error('Failed to fetch database stats');
  return response.json();
};

/**
 * Export all scans as JSON or CSV
 * Downloads the file directly in the browser
 */
export const exportScans = async (format: 'json' | 'csv'): Promise<void> => {
  const response = await fetch(`${API_BASE}/scans/export?format=${format}`);
  if (!response.ok) throw new Error('Failed to export scans');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scans_export.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Process receipt with Tesseract.js (browser fallback)
 */
export const processWithTesseract = async (
  file: File,
  onLog?: LogFn
): Promise<OcrResponse> => {
  onLog?.('Processing with Tesseract.js (browser)...', 'info');

  if (!createWorker) {
    throw new Error('Tesseract.js not available');
  }

  const worker = await createWorker('eng');
  const result = await worker.recognize(file);
  await worker.terminate();

  const lines = result.data.text.split('\n').filter((l: string) => l.trim());

  // Parse into blocks format
  const blocks = lines.map((text: string, i: number) => ({
    text,
    confidence: result.data.confidence / 100,
    _x: 0,
    _y: i * 30,
    _w: 200,
    _h: 25
  }));

  // Simple receipt parsing for Tesseract results
  const parsed = parseReceiptText(lines);

  onLog?.(`OCR complete: ${blocks.length} lines detected`, 'success');

  return {
    success: true,
    filename: file.name,
    blocks,
    raw_text: result.data.text,
    parsed
  };
};

/**
 * Network diagnostics response type
 */
export interface NetworkDiagnostics {
  ports: {
    [port: string]: {
      listening: boolean;
      all_interfaces: boolean;
    };
  };
  firewall: {
    type: string;
    active: boolean;
    command?: string;
  };
  local_ips: string[];
  network_url: string | null;
  instructions: Array<{
    issue: string;
    fix: string;
  }>;
}

/**
 * Fetch network diagnostics from backend
 */
export const getNetworkDiagnostics = async (): Promise<NetworkDiagnostics | null> => {
  try {
    const response = await fetch(`${API_BASE}/network-diagnostics`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};
