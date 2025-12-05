/**
 * Docker Status Component
 * Shows connection status and setup instructions for the backend container
 */
import { useState, useEffect } from 'react';
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

  useEffect(() => {
    systemLogger.info('docker', '🐳 Starting Docker health monitoring...');

    dockerHealthService.startMonitoring((newStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus.isHealthy);

      if (newStatus.isHealthy) {
        systemLogger.success('docker', `✅ Docker backend healthy: ${newStatus.ocrEngine || 'PaddleOCR'}`);
      } else {
        systemLogger.warn('docker', `⚠️ Docker backend unavailable: ${newStatus.error || 'Connection failed'}`);
      }
    });

    return () => dockerHealthService.stopMonitoring();
  }, [onStatusChange]);

  const handleRetry = async () => {
    setChecking(true);
    systemLogger.info('docker', '🔄 Retrying Docker connection...');

    const newStatus = await dockerHealthService.forceCheck();
    setStatus(newStatus);
    onStatusChange?.(newStatus.isHealthy);
    setChecking(false);
  };

  if (!status) {
    return (
      <div className="docker-status checking">
        <span className="status-icon">🔄</span>
        <span>Checking Docker connection...</span>
      </div>
    );
  }

  const instructions = dockerHealthService.getSetupInstructions();

  if (status.isHealthy) {
    return (
      <div className="docker-status healthy">
        <span className="status-icon">✅</span>
        <span>PaddleOCR Ready</span>
        {status.ocrEngine && <span className="badge">{status.ocrEngine}</span>}
      </div>
    );
  }

  return (
    <div className="docker-status unhealthy">
      <div className="status-header" onClick={() => setExpanded(!expanded)}>
        <span className="status-icon">⚠️</span>
        <span className="status-text">Docker Backend Unavailable</span>
        <span className="expand-icon">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="status-details">
          <p className="error-message">
            <strong>Error:</strong> {status.error || 'Cannot connect to backend on port 5001'}
          </p>

          {status.retryCount > 0 && (
            <p className="retry-info">
              Retry attempts: {status.retryCount} / 3
            </p>
          )}

          <div className="fallback-info">
            <p>📋 Using browser-based Tesseract.js as fallback</p>
            <p>💡 For better results, start the Docker backend:</p>
          </div>

          <div className="setup-instructions">
            <h4>Setup ({instructions.platform})</h4>
            <ol>
              {instructions.steps.map((step, i) => (
                <li key={i}>
                  {step.includes('docker compose') ? (
                    <code>{step}</code>
                  ) : (
                    step
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="status-actions">
            <button
              className="retry-btn"
              onClick={handleRetry}
              disabled={checking}
            >
              {checking ? '🔄 Checking...' : '🔁 Retry Connection'}
            </button>

            {onTroubleshoot && (
              <button
                className="troubleshoot-btn"
                onClick={onTroubleshoot}
              >
                🔧 Run Diagnostics
              </button>
            )}
          </div>

          <a
            href="https://github.com/swipswaps/receipts-ocr"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
          >
            📚 View Full Setup Guide
          </a>
        </div>
      )}
    </div>
  );
};

export default DockerStatus;
