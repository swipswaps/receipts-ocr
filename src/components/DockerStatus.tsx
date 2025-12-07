/**
 * Docker Status Component
 * Shows connection status and setup instructions for the backend container
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { dockerHealthService } from '../services/dockerHealthService';
import type { DockerHealthStatus } from '../services/dockerHealthService';
import { systemLogger } from '../services/systemLogger';

interface DockerStatusProps {
  onStatusChange?: (isHealthy: boolean) => void;
  onTroubleshoot?: () => void;
}

export const DockerStatus = ({ onStatusChange, onTroubleshoot }: DockerStatusProps) => {
  const [status, setStatus] = useState<DockerHealthStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  // Use refs to prevent re-registering monitoring on every render
  const onStatusChangeRef = useRef(onStatusChange);
  const hasStartedRef = useRef(false);

  // Keep ref updated
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Stable callback that uses ref
  const handleStatusChange = useCallback((newStatus: DockerHealthStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus.isHealthy);
  }, []);

  useEffect(() => {
    // Only start monitoring once
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    systemLogger.info('docker', '🐳 Starting Docker health monitoring...');

    dockerHealthService.startMonitoring((newStatus) => {
      handleStatusChange(newStatus);

      // Only log on status changes, not every health check
      // The service already logs via systemLogger interceptor
    });

    return () => dockerHealthService.stopMonitoring();
  }, [handleStatusChange]);

  const handleRetry = async () => {
    setChecking(true);
    systemLogger.info('docker', '🔄 Retrying Docker connection...');

    const newStatus = await dockerHealthService.forceCheck();
    setStatus(newStatus);
    onStatusChange?.(newStatus.isHealthy);
    setChecking(false);
  };

  // Derived values (computed from state, not hooks)
  const instructions = dockerHealthService.getSetupInstructions();
  const isGitHubPages = window.location.hostname.includes('github.io');
  const isWindows = navigator.userAgent.toLowerCase().includes('win');
  const scriptUrl = isWindows
    ? 'https://raw.githubusercontent.com/swipswaps/receipts-ocr/main/scripts/setup.ps1'
    : 'https://raw.githubusercontent.com/swipswaps/receipts-ocr/main/scripts/setup.sh';
  const oneLiner = isWindows
    ? 'irm https://raw.githubusercontent.com/swipswaps/receipts-ocr/main/scripts/setup.ps1 | iex'
    : 'curl -fsSL https://raw.githubusercontent.com/swipswaps/receipts-ocr/main/scripts/setup.sh | bash';

  const copyOneLiner = async () => {
    try {
      await navigator.clipboard.writeText(oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = oneLiner;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Early returns for loading and healthy states
  if (!status) {
    return (
      <div className="docker-status checking">
        <span className="status-icon">🔄</span>
        <span>Checking Docker connection...</span>
      </div>
    );
  }

  if (status.isHealthy) {
    return (
      <div className="docker-status healthy">
        <span className="status-icon">✅</span>
        <span>PaddleOCR Ready</span>
        {status.ocrEngine && <span className="badge">{status.ocrEngine}</span>}
      </div>
    );
  }

  // Unhealthy state - show setup instructions
  return (
    <div className="docker-status unhealthy">
      <div className="status-header" onClick={() => setExpanded(!expanded)}>
        <span className="status-icon">⚠️</span>
        <span className="status-text">Docker Backend Required</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="status-details">
          {isGitHubPages && (
            <div className="github-pages-notice">
              <p><strong>🌐 You're viewing this on GitHub Pages</strong></p>
              <p>This is a <em>frontend-only</em> demo. For high-accuracy PaddleOCR, run the setup locally.</p>
            </div>
          )}

          <p className="error-message">
            <strong>Status:</strong> {status.error || 'Cannot connect to backend on port 5001'}
          </p>

          {status.retryCount > 0 && (
            <p className="retry-info">
              Connection attempts: {status.retryCount} / 3
            </p>
          )}

          <div className="fallback-info">
            <p>📋 Currently using browser-based Tesseract.js (lower accuracy)</p>
            <p>🚀 <strong>For 10x better results</strong>, run the automated setup:</p>
          </div>

          {/* One-click setup section */}
          <div className="quick-setup">
            <h4>🎯 Quick Setup (one command)</h4>
            <p>Open {isWindows ? 'PowerShell (Admin)' : 'Terminal'} and paste:</p>
            <div className="one-liner-container">
              <code className="one-liner">{oneLiner}</code>
              <button
                className="copy-btn"
                onClick={copyOneLiner}
                title="Copy to clipboard"
              >
                {copied ? '✓' : '📋'}
              </button>
            </div>
            <p className="script-info">
              This script will: check Docker → clone repo → build containers → start app
              <br />
              <small>All steps show real-time progress and error messages.</small>
            </p>
          </div>

          {/* Manual steps as fallback */}
          <details className="manual-steps">
            <summary>📝 Or follow manual steps ({instructions.platform})</summary>
            <ol>
              {instructions.steps.map((step, i) => (
                <li key={i}>
                  {step.includes('docker') || step.includes('git') || step.includes('npm') || step.includes('curl') ? (
                    <code>{step}</code>
                  ) : (
                    step
                  )}
                </li>
              ))}
            </ol>
          </details>

          <div className="status-actions">
            <button
              className="retry-btn"
              onClick={handleRetry}
              disabled={checking}
            >
              {checking ? '🔄 Checking...' : '🔁 Test Connection'}
            </button>

            <a
              href={scriptUrl}
              download
              className="download-btn"
            >
              📥 Download Script
            </a>

            {onTroubleshoot && (
              <button
                className="troubleshoot-btn"
                onClick={onTroubleshoot}
              >
                🔧 Diagnostics
              </button>
            )}
          </div>

          <a
            href="https://github.com/swipswaps/receipts-ocr#troubleshooting-docker"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
          >
            📚 Troubleshooting Guide
          </a>
        </div>
      )}
    </div>
  );
};

export default DockerStatus;
