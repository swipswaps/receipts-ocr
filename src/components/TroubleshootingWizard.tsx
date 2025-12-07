/**
 * Smart Troubleshooting Wizard
 * Diagnoses Docker/OCR issues and guides users through resolution
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { systemLogger } from '../services/systemLogger';
import { API_BASE } from '../config';

export interface DiagnosticResult {
  check: string;
  status: 'pass' | 'fail' | 'warn' | 'checking';
  message: string;
  fix?: string;
  command?: string;
}

interface TroubleshootingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onDiagnosticsComplete?: (results: DiagnosticResult[]) => void;
}

const DIAGNOSTIC_CHECKS = [
  { id: 'docker_installed', name: 'Docker Installation' },
  { id: 'docker_running', name: 'Docker Service' },
  { id: 'backend_reachable', name: 'Backend Connectivity' },
  { id: 'health_endpoint', name: 'Health Endpoint' },
  { id: 'ocr_endpoint', name: 'OCR Endpoint' },
  { id: 'cors_config', name: 'CORS Configuration' },
];

export const TroubleshootingWizard = ({ isOpen, onClose, onDiagnosticsComplete }: TroubleshootingWizardProps) => {
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runDiagnostics = useCallback(async () => {
    setIsRunning(true);
    setResults([]);
    systemLogger.info('troubleshoot', '🔍 Starting diagnostic checks...');
    const newResults: DiagnosticResult[] = [];

    // Check 1: Can we reach the backend at all?
    setCurrentStep(1);
    try {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5000);

      const start = Date.now();
      const response = await fetch(`${API_BASE}/`, {
        method: 'HEAD',
        signal: controller.signal,
      }).catch(() => null);

      const latency = Date.now() - start;

      if (response) {
        newResults.push({
          check: 'Backend Connectivity',
          status: 'pass',
          message: `Backend reachable (${latency}ms latency)`,
        });
        systemLogger.success('troubleshoot', `✅ Backend reachable (${latency}ms)`);
      } else {
        newResults.push({
          check: 'Backend Connectivity',
          status: 'fail',
          message: `Cannot connect to ${API_BASE}`,
          fix: 'Start the Docker container with: docker compose up -d',
          command: 'docker compose up -d',
        });
        systemLogger.error('troubleshoot', `❌ Backend not reachable at ${API_BASE}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      newResults.push({
        check: 'Backend Connectivity',
        status: 'fail',
        message: `Connection failed: ${msg}`,
        fix: 'Make sure Docker is running and the container is started',
        command: 'docker compose up -d',
      });
      systemLogger.error('troubleshoot', `❌ Backend connection failed: ${msg}`);
    }
    setResults([...newResults]);

    // Check 2: Health endpoint
    setCurrentStep(2);
    try {
      const response = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        newResults.push({
          check: 'Health Endpoint',
          status: data.status === 'healthy' ? 'pass' : 'warn',
          message: `Status: ${data.status}, OCR: ${data.ocr_engine || 'unknown'}, DB: ${data.database || 'unknown'}`,
        });
        systemLogger.success('troubleshoot', `✅ Health: ${JSON.stringify(data)}`);
      } else {
        newResults.push({
          check: 'Health Endpoint',
          status: 'fail',
          message: `Health check returned ${response.status}: ${response.statusText}`,
          fix: 'Check container logs: docker compose logs backend',
          command: 'docker compose logs backend',
        });
        systemLogger.warn('troubleshoot', `⚠️ Health endpoint returned ${response.status}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      newResults.push({
        check: 'Health Endpoint',
        status: 'fail',
        message: `Health check failed: ${msg}`,
        fix: 'Backend may not be fully started. Wait 60 seconds after docker compose up.',
      });
      systemLogger.error('troubleshoot', `❌ Health check failed: ${msg}`);
    }
    setResults([...newResults]);

    // Check 3: OCR endpoint (OPTIONS to test CORS)
    setCurrentStep(3);
    try {
      const response = await fetch(`${API_BASE}/ocr`, {
        method: 'OPTIONS',
      });

      const corsHeader = response.headers.get('Access-Control-Allow-Origin');
      if (corsHeader) {
        newResults.push({
          check: 'CORS Configuration',
          status: 'pass',
          message: `CORS enabled: ${corsHeader}`,
        });
        systemLogger.success('troubleshoot', `✅ CORS: ${corsHeader}`);
      } else {
        newResults.push({
          check: 'CORS Configuration',
          status: 'warn',
          message: 'CORS header not detected (may still work)',
        });
        systemLogger.warn('troubleshoot', '⚠️ CORS header not detected');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      newResults.push({
        check: 'CORS Configuration',
        status: 'fail',
        message: `CORS check failed: ${msg}`,
        fix: 'This usually means the backend is not running',
      });
      systemLogger.error('troubleshoot', `❌ CORS check failed: ${msg}`);
    }
    setResults([...newResults]);

    // Check 4: Test OCR with a tiny image
    setCurrentStep(4);
    try {
      // Create a 1x1 white PNG
      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 10, 10);
      ctx.fillStyle = 'black';
      ctx.fillText('T', 2, 8);

      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
      const formData = new FormData();
      formData.append('file', blob, 'test.png');

      const start = Date.now();
      const response = await fetch(`${API_BASE}/ocr`, {
        method: 'POST',
        body: formData,
      });
      const latency = Date.now() - start;

      if (response.ok) {
        const data = await response.json();
        newResults.push({
          check: 'OCR Endpoint',
          status: 'pass',
          message: `OCR working (${latency}ms). Response has ${data.blocks?.length || 0} blocks.`,
        });
        systemLogger.success('troubleshoot', `✅ OCR endpoint working (${latency}ms)`);
      } else {
        const text = await response.text();
        newResults.push({
          check: 'OCR Endpoint',
          status: 'fail',
          message: `OCR returned ${response.status}: ${text.slice(0, 100)}`,
          fix: 'PaddleOCR may still be initializing. Wait 60 seconds and retry.',
        });
        systemLogger.error('troubleshoot', `❌ OCR returned ${response.status}: ${text.slice(0, 100)}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      newResults.push({
        check: 'OCR Endpoint',
        status: 'fail',
        message: `OCR test failed: ${msg}`,
        fix: 'Check container logs: docker compose logs backend',
        command: 'docker compose logs backend',
      });
      systemLogger.error('troubleshoot', `❌ OCR test failed: ${msg}`);
    }
    setResults([...newResults]);

    setCurrentStep(5);
    setIsRunning(false);
    onDiagnosticsComplete?.(newResults);

    const passed = newResults.filter(r => r.status === 'pass').length;
    const failed = newResults.filter(r => r.status === 'fail').length;
    systemLogger.info('troubleshoot', `🏁 Diagnostics complete: ${passed} passed, ${failed} failed`);
  }, [onDiagnosticsComplete]);

  // Run diagnostics when wizard opens
  const hasRun = useRef(false);
  useEffect(() => {
    if (isOpen && !hasRun.current) {
      hasRun.current = true;
      // Use setTimeout to avoid setState during render
      const timer = setTimeout(() => runDiagnostics(), 0);
      return () => clearTimeout(timer);
    }
    if (!isOpen) {
      hasRun.current = false;
    }
  }, [isOpen, runDiagnostics]);

  if (!isOpen) return null;

  const statusIcon = (status: DiagnosticResult['status']) => {
    switch (status) {
      case 'pass': return '✅';
      case 'fail': return '❌';
      case 'warn': return '⚠️';
      case 'checking': return '🔄';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    systemLogger.info('user', `Copied to clipboard: ${text}`);
  };

  return (
    <div className="troubleshooting-wizard-overlay" onClick={onClose}>
      <div className="troubleshooting-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <h2>🔧 Troubleshooting Wizard</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="wizard-content">
          {isRunning && (
            <div className="running-indicator">
              <span className="spinner">🔄</span>
              Running diagnostic {currentStep} of {DIAGNOSTIC_CHECKS.length}...
            </div>
          )}

          <div className="diagnostic-results">
            {results.map((result, i) => (
              <div
                key={i}
                className={`diagnostic-item ${result.status}`}
                onClick={() => setExpanded(expanded === result.check ? null : result.check)}
              >
                <div className="diagnostic-header">
                  <span className="status-icon">{statusIcon(result.status)}</span>
                  <span className="check-name">{result.check}</span>
                  {result.fix && <span className="expand-hint">▼</span>}
                </div>
                <div className="diagnostic-message">{result.message}</div>

                {expanded === result.check && result.fix && (
                  <div className="diagnostic-fix">
                    <strong>How to fix:</strong>
                    <p>{result.fix}</p>
                    {result.command && (
                      <div className="command-block">
                        <code>{result.command}</code>
                        <button onClick={() => copyToClipboard(result.command!)}>📋 Copy</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {!isRunning && results.length > 0 && (
            <div className="wizard-actions">
              <button className="retry-btn" onClick={runDiagnostics}>
                🔄 Run Again
              </button>
              <button className="close-btn" onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TroubleshootingWizard;
