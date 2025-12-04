// Receipt OCR Types

export interface ReceiptItem {
  id?: number;
  name: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
}

export interface ParsedReceipt {
  store_name: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

export interface OcrBlock {
  text: string;
  confidence: number;
  _x: number;
  _y: number;
  _w: number;
  _h: number;
}

export interface OcrResponse {
  success: boolean;
  filename: string;
  blocks: OcrBlock[];
  raw_text: string;
  parsed: ParsedReceipt;
  error?: string;
}

export interface Receipt {
  id: number;
  filename: string;
  store_name: string | null;
  receipt_date: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  raw_text: string;
  created_at: string;
  items?: ReceiptItem[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface BackendHealth {
  status: 'checking' | 'healthy' | 'unhealthy';
  ocr_engine?: string;
  database?: string;
}

export type OcrEngine = 'docker' | 'tesseract';

export type OutputTab = 'text' | 'json' | 'csv' | 'xlsx' | 'sql';
