/**
 * Receipts OCR App - Main Component
 * Based on Docker-OCR-2 patterns from llm_notes
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Upload, FileText, Database, Trash2, Save, RefreshCw, CheckCircle, AlertCircle, Info, AlertTriangle, Download, RotateCcw, RotateCw } from 'lucide-react';
import type { OcrResponse, Receipt, LogEntry, BackendHealth, OcrEngine, OutputTab } from './types';
import {
  checkBackendHealth,
  preprocessImage,
  processWithDocker,
  processWithTesseract,
  listReceipts,
  saveReceipt,
  deleteReceipt,
  rotateImageCanvas
} from './services/ocrService';
import { autoCorrectRotation } from './services/angleDetectionService';
import './App.css';
import { DockerStatus } from './components/DockerStatus';
import { SystemLogsPanel } from './components/SystemLogsPanel';
import { TroubleshootingWizard } from './components/TroubleshootingWizard';
import { systemLogger } from './services/systemLogger';

function App() {
  // State
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreprocessing, setIsPreprocessing] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [backendHealth, setBackendHealth] = useState<BackendHealth>({ status: 'checking' });
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('docker');
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>('text');
  const [extractedText, setExtractedText] = useState<string>('');
  const [showSystemLogs, setShowSystemLogs] = useState(false);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Logging helper
  const addLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      level,
      message
    }]);
  }, []);

  // Check backend health on mount
  useEffect(() => {
    const checkHealth = async () => {
      const healthy = await checkBackendHealth();
      setBackendHealth({
        status: healthy ? 'healthy' : 'unhealthy',
        ocr_engine: healthy ? 'PaddleOCR' : undefined,
        database: healthy ? 'PostgreSQL' : undefined
      });
      if (!healthy) {
        addLog('Docker backend unavailable, using Tesseract.js fallback', 'warn');
        setOcrEngine('tesseract');
      } else {
        addLog('Docker backend connected (PaddleOCR + PostgreSQL)', 'success');
      }
    };
    checkHealth();
  }, [addLog]);

  // Load receipts function
  const loadReceipts = useCallback(async () => {
    try {
      const data = await listReceipts();
      setReceipts(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Failed to load receipts: ${msg}`, 'error');
    }
  }, [addLog]);

  // Load receipts when switching to history tab
  useEffect(() => {
    if (activeTab === 'history' && backendHealth.status === 'healthy') {
      loadReceipts();
    }
  }, [activeTab, backendHealth.status, loadReceipts]);

  // File handling
  const handleFileSelect = useCallback(async (selectedFile: File) => {
    // Clear previous state and start preprocessing
    setFile(null); // Don't set file until preprocessing is complete
    setPreview(null);
    setOcrResult(null);
    setLogs([]);
    setIsPreprocessing(true);

    addLog(`Selected: ${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`, 'info');

    try {
      // Step 1: Preprocess (HEIC conversion, EXIF rotation)
      const processed = await preprocessImage(selectedFile, addLog);

      // Step 2: Auto-detect text orientation via Tesseract OSD (if Docker backend available)
      let finalImageDataUrl: string;
      const processedDataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.readAsDataURL(processed);
      });

      if (backendHealth.status === 'healthy') {
        addLog('Auto-detecting text orientation via Tesseract OSD...', 'info');
        const rotationResult = await autoCorrectRotation(processedDataUrl, 0.3);
        finalImageDataUrl = rotationResult.imageDataUrl;
        if (rotationResult.corrected) {
          addLog(`Applied ${rotationResult.angle}° rotation correction`, 'success');
        }
      } else {
        finalImageDataUrl = processedDataUrl;
      }

      // Set preview
      setPreview(finalImageDataUrl);

      // Convert data URL back to File for OCR processing
      const response = await fetch(finalImageDataUrl);
      const blob = await response.blob();
      const finalFile = new File([blob], processed.name, { type: blob.type });
      setFile(finalFile);
      addLog('Image ready for OCR', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Preprocessing failed: ${msg}`, 'error');
    } finally {
      setIsPreprocessing(false);
    }
  }, [addLog, backendHealth.status]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  // OCR Processing
  const processReceipt = async () => {
    if (!file) return;

    setIsProcessing(true);
    // Don't clear logs - keep preprocessing logs visible

    try {
      let result: OcrResponse;

      if (ocrEngine === 'docker' && backendHealth.status === 'healthy') {
        result = await processWithDocker(file, addLog);
      } else {
        result = await processWithTesseract(file, addLog);
      }

      setOcrResult(result);
      setExtractedText(result.raw_text || '');

      if (result.parsed) {
        const { items, total } = result.parsed;
        addLog(`Parsed: ${items.length} items, Total: $${total?.toFixed(2) || 'N/A'}`, 'success');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`OCR failed: ${msg}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };


  // Output format converters
  const jsonOutput = useMemo(() => {
    if (!ocrResult?.blocks?.length) return JSON.stringify({ text: extractedText }, null, 2);
    return JSON.stringify(ocrResult.blocks, null, 2);
  }, [ocrResult, extractedText]);

  const csvOutput = useMemo(() => {
    if (!extractedText) return '';
    const lines = extractedText.split('\n').filter((l: string) => l.trim());
    return lines.map((line: string) => `"${line.replace(/"/g, '""')}"`).join('\n');
  }, [extractedText]);

  const sqlOutput = useMemo(() => {
    if (!extractedText) return '';
    const escaped = extractedText.replace(/'/g, "''");
    return `-- OCR Result\nINSERT INTO ocr_results (text) VALUES ('${escaped}');`;
  }, [extractedText]);

  // Download handler
  const handleDownload = (downloadContent: string, filename: string, type: string) => {
    const blob = new Blob([downloadContent], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog(`Downloaded ${filename}`, 'success');
  };

  // XLSX Download handler
  const handleDownloadXLSX = async () => {
    try {
      const XLSX = await import('xlsx');
      const lines = extractedText.split('\n').filter((l: string) => l.trim());
      const data = lines.map((line: string) => ({ A: line }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'OCR Results');
      XLSX.writeFile(wb, 'ocr_results.xlsx');
      addLog('Downloaded ocr_results.xlsx', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`XLSX download failed: ${msg}`, 'error');
    }
  };

  // Manual rotation handler
  const handleRotate = async (direction: 'left' | 'right') => {
    if (!file) return;
    try {
      const angle = direction === 'left' ? 270 : 90;
      const rotated = await rotateImageCanvas(file, angle);
      setFile(rotated);
      setPreview(URL.createObjectURL(rotated));
      addLog(`Rotated image ${angle}° ${direction === 'left' ? 'CCW' : 'CW'}`, 'info');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Rotation failed: ${msg}`, 'error');
    }
  };

  // Save to database
  const handleSave = async () => {
    if (!ocrResult || !file) return;

    try {
      const { receipt_id } = await saveReceipt(
        file.name,
        ocrResult.parsed,
        ocrResult.raw_text
      );
      addLog(`Receipt saved to database (ID: ${receipt_id})`, 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Save failed: ${msg}`, 'error');
    }
  };

  // Delete receipt
  const handleDelete = async (id: number) => {
    try {
      await deleteReceipt(id);
      setReceipts(prev => prev.filter(r => r.id !== id));
      addLog(`Receipt ${id} deleted`, 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      addLog(`Delete failed: ${msg}`, 'error');
    }
  };

  const LogIcon = ({ level }: { level: LogEntry['level'] }) => {
    switch (level) {
      case 'success': return <CheckCircle className="log-icon success" size={14} />;
      case 'error': return <AlertCircle className="log-icon error" size={14} />;
      case 'warn': return <AlertTriangle className="log-icon warn" size={14} />;
      default: return <Info className="log-icon info" size={14} />;
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1><FileText size={28} /> Receipts OCR</h1>
        <DockerStatus
          onStatusChange={(isHealthy) => {
            setBackendHealth({
              status: isHealthy ? 'healthy' : 'unhealthy',
              ocr_engine: isHealthy ? 'PaddleOCR' : undefined,
              database: isHealthy ? 'PostgreSQL' : undefined
            });
            if (isHealthy) {
              setOcrEngine('docker');
              systemLogger.success('docker', 'Switched to PaddleOCR backend');
            } else {
              setOcrEngine('tesseract');
              systemLogger.warn('docker', 'Switched to Tesseract.js fallback');
            }
          }}
          onTroubleshoot={() => setShowTroubleshooter(true)}
        />
      </header>

      <nav className="tabs">
        <button
          className={activeTab === 'upload' ? 'active' : ''}
          onClick={() => {
            // If already on upload tab, trigger file selection
            // Otherwise just switch to upload tab
            if (activeTab === 'upload') {
              fileInputRef.current?.click();
            } else {
              setActiveTab('upload');
            }
          }}
        >
          <Upload size={16} /> Upload
        </button>
        <button
          className={activeTab === 'history' ? 'active' : ''}
          onClick={() => setActiveTab('history')}
          disabled={backendHealth.status !== 'healthy'}
        >
          <Database size={16} /> History
        </button>
      </nav>

      <main className="main">
        {activeTab === 'upload' ? (
          <div className="upload-view">
            {/* Drop Zone */}
            <div
              className="dropzone"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.heic"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                hidden
              />
              {preview ? (
                <div className="preview-container">
                  <img src={preview} alt="Receipt preview" className="preview" />
                  <div className="rotation-controls">
                    <button
                      className="rotate-btn"
                      onClick={() => handleRotate('left')}
                      title="Rotate 90° counter-clockwise"
                    >
                      <RotateCcw size={20} />
                    </button>
                    <button
                      className="rotate-btn"
                      onClick={() => handleRotate('right')}
                      title="Rotate 90° clockwise"
                    >
                      <RotateCw size={20} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="dropzone-placeholder">
                  <Upload size={48} />
                  <p>Drop receipt image or click to upload</p>
                  <small>Supports JPEG, PNG, HEIC</small>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="actions">
              <button
                className="btn primary"
                onClick={processReceipt}
                disabled={!file || isProcessing || isPreprocessing}
              >
                {isProcessing ? <RefreshCw className="spin" size={16} /> : isPreprocessing ? <RefreshCw className="spin" size={16} /> : <FileText size={16} />}
                {isProcessing ? 'Processing...' : isPreprocessing ? 'Preparing...' : 'Extract Text'}
              </button>

              {ocrResult && backendHealth.status === 'healthy' && (
                <button className="btn secondary" onClick={handleSave}>
                  <Save size={16} /> Save to Database
                </button>
              )}
            </div>

            {/* Logs */}
            {logs.length > 0 && (
              <div className="logs">
                {logs.map((log, i) => (
                  <div key={i} className={`log-entry ${log.level}`}>
                    <LogIcon level={log.level} />
                    <span className="log-time">{log.timestamp}</span>
                    <span className="log-msg">{log.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Output Tabs */}
            {ocrResult && (
              <div className="output-section">
                <div className="output-tabs">
                  {(['text', 'json', 'csv', 'xlsx', 'sql'] as const).map((tab) => (
                    <button
                      key={tab}
                      className={`output-tab ${activeOutputTab === tab ? 'active' : ''}`}
                      onClick={() => setActiveOutputTab(tab)}
                    >
                      {tab === 'text' && '📄 Text'}
                      {tab === 'json' && '🔧 JSON'}
                      {tab === 'csv' && '📊 CSV'}
                      {tab === 'xlsx' && '📗 XLSX'}
                      {tab === 'sql' && '🗄️ SQL'}
                    </button>
                  ))}
                </div>

                <div className="output-content">
                  {activeOutputTab === 'text' && (
                    <div className="output-panel">
                      <div className="output-header">
                        <span>Extracted Text</span>
                        <button className="download-btn" onClick={() => handleDownload(extractedText, 'ocr_result.txt', 'text/plain')}>
                          <Download size={14} /> Download .txt
                        </button>
                      </div>
                      <textarea
                        value={extractedText}
                        onChange={(e) => setExtractedText(e.target.value)}
                        className="output-textarea"
                      />
                    </div>
                  )}

                  {activeOutputTab === 'json' && (
                    <div className="output-panel">
                      <div className="output-header">
                        <span>JSON Output ({ocrResult.blocks?.length || 0} blocks)</span>
                        <button className="download-btn json" onClick={() => handleDownload(jsonOutput, 'ocr_result.json', 'application/json')}>
                          <Download size={14} /> Download .json
                        </button>
                      </div>
                      <textarea value={jsonOutput} readOnly className="output-textarea code" />
                    </div>
                  )}

                  {activeOutputTab === 'csv' && (
                    <div className="output-panel">
                      <div className="output-header">
                        <span>CSV Output</span>
                        <button className="download-btn csv" onClick={() => handleDownload(csvOutput, 'ocr_result.csv', 'text/csv')}>
                          <Download size={14} /> Download .csv
                        </button>
                      </div>
                      <textarea value={csvOutput} readOnly className="output-textarea" />
                    </div>
                  )}

                  {activeOutputTab === 'xlsx' && (
                    <div className="output-panel">
                      <div className="output-header">
                        <span>Excel Preview</span>
                        <button className="download-btn xlsx" onClick={handleDownloadXLSX}>
                          <Download size={14} /> Download .xlsx
                        </button>
                      </div>
                      <div className="xlsx-preview">
                        <table>
                          <thead>
                            <tr><th></th><th>A</th></tr>
                          </thead>
                          <tbody>
                            {extractedText.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                              <tr key={i}>
                                <td className="row-num">{i + 1}</td>
                                <td>{line}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {activeOutputTab === 'sql' && (
                    <div className="output-panel">
                      <div className="output-header">
                        <span>SQL Output</span>
                        <button className="download-btn sql" onClick={() => handleDownload(sqlOutput, 'ocr_result.sql', 'text/plain')}>
                          <Download size={14} /> Download .sql
                        </button>
                      </div>
                      <textarea value={sqlOutput} readOnly className="output-textarea code sql" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="history-view">
            <div className="history-header">
              <h2>Saved Receipts</h2>
              <button className="btn secondary" onClick={loadReceipts}>
                <RefreshCw size={16} /> Refresh
              </button>
            </div>

            {receipts.length === 0 ? (
              <p className="empty">No receipts saved yet</p>
            ) : (
              <div className="receipts-list">
                {receipts.map(receipt => (
                  <div key={receipt.id} className="receipt-card">
                    <div className="receipt-info">
                      <strong>{receipt.store_name || receipt.filename}</strong>
                      <small>{new Date(receipt.created_at).toLocaleDateString()}</small>
                    </div>
                    <div className="receipt-total">
                      ${receipt.total?.toFixed(2) || '—'}
                    </div>
                    <button
                      className="btn icon"
                      onClick={() => handleDelete(receipt.id)}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {/* System Logs Panel */}
      <SystemLogsPanel
        isOpen={showSystemLogs}
        onToggle={() => setShowSystemLogs(!showSystemLogs)}
      />

      {/* Troubleshooting Wizard Modal */}
      <TroubleshootingWizard
        isOpen={showTroubleshooter}
        onClose={() => setShowTroubleshooter(false)}
      />
    </div>
  );
}

export default App;
