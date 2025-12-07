/**
 * ScanDetailsModal - Modal component for viewing OCR scan details
 * Simplified version - just shows filename, timestamp, and raw text
 */
import { useEffect, useCallback, useState } from 'react';
import { X, FileText, Download, Loader2, Trash2, Copy, Check } from 'lucide-react';
import type { Scan } from '../types';
import { getScan, deleteScan } from '../services/ocrService';

interface ScanDetailsModalProps {
  scanId: number;
  onClose: () => void;
  onDeleted?: () => void;
}

export function ScanDetailsModal({ scanId, onClose, onDeleted }: ScanDetailsModalProps) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Fetch scan details when modal opens
  useEffect(() => {
    const fetchScan = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getScan(scanId);
        setScan(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load scan');
      } finally {
        setLoading(false);
      }
    };
    fetchScan();
  }, [scanId]);

  // Handle escape key to close modal
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Copy text to clipboard
  const handleCopy = async () => {
    if (!scan?.raw_text) return;
    await navigator.clipboard.writeText(scan.raw_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export as text file
  const handleExport = () => {
    if (!scan) return;
    const blob = new Blob([scan.raw_text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scan.filename.replace(/\.[^.]+$/, '')}_ocr.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Delete scan
  const handleDelete = async () => {
    if (!scan || !confirm('Delete this scan?')) return;
    setDeleting(true);
    try {
      await deleteScan(scan.id);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content scan-details-modal">
        <header className="modal-header">
          <h2><FileText size={20} /> Scan Details</h2>
          <div className="modal-actions">
            <button className="btn icon" onClick={handleCopy} title="Copy text">
              {copied ? <Check size={18} /> : <Copy size={18} />}
            </button>
            <button className="btn icon" onClick={handleExport} title="Download .txt">
              <Download size={18} />
            </button>
            <button
              className="btn icon danger"
              onClick={handleDelete}
              title="Delete"
              disabled={deleting}
            >
              {deleting ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
            </button>
            <button className="btn icon" onClick={onClose} title="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="modal-body">
          {loading && (
            <div className="loading-state">
              <Loader2 className="spin" size={32} />
              <p>Loading scan...</p>
            </div>
          )}

          {error && (
            <div className="error-state">
              <p>❌ {error}</p>
              <button className="btn secondary" onClick={onClose}>Close</button>
            </div>
          )}

          {scan && !loading && (
            <>
              <div className="scan-meta">
                <div className="meta-row">
                  <span className="label">File:</span>
                  <span className="value">{scan.filename}</span>
                </div>
                <div className="meta-row">
                  <span className="label">Saved:</span>
                  <span className="value">{new Date(scan.created_at).toLocaleString()}</span>
                </div>
                <div className="meta-row">
                  <span className="label">Characters:</span>
                  <span className="value">{scan.raw_text.length.toLocaleString()}</span>
                </div>
              </div>

              <div className="raw-text-section">
                <h3>OCR Text</h3>
                <pre className="raw-text">{scan.raw_text}</pre>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
