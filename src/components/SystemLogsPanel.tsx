/**
 * System Logs Panel
 * Shows all system events, network requests, and diagnostic logs
 */
import { useState, useEffect, useRef } from 'react';
import { systemLogger, type SystemLogEntry, type LogLevel } from '../services/systemLogger';

interface SystemLogsPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  success: '✅',
  warn: '⚠️',
  error: '❌',
  system: '⚙️',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#888',
  info: '#4a9eff',
  success: '#00c853',
  warn: '#ffab00',
  error: '#ff5252',
  system: '#9e9e9e',
};

const CATEGORY_BADGES: Record<string, string> = {
  network: '🌐',
  ocr: '📝',
  docker: '🐳',
  system: '⚙️',
  user: '👤',
  troubleshoot: '🔧',
};

export const SystemLogsPanel = ({ isOpen, onToggle }: SystemLogsPanelProps) => {
  const [logs, setLogs] = useState<SystemLogEntry[]>(() => systemLogger.getLogs());
  const [filter, setFilter] = useState<{ level?: LogLevel; category?: string }>({});
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {

    // Subscribe to new logs
    const unsubscribe = systemLogger.subscribe((entry) => {
      setLogs(prev => [...prev.slice(-499), entry]);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter(log => {
    if (filter.level && log.level !== filter.level) return false;
    if (filter.category && log.category !== filter.category) return false;
    return true;
  });

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  return (
    <div className={`system-logs-panel ${isOpen ? 'open' : 'closed'}`}>
      <div className="logs-header" onClick={onToggle}>
        <span className="logs-title">
          📋 System Logs
          {!isOpen && logs.length > 0 && (
            <span className="log-count">({logs.length})</span>
          )}
        </span>
        <span className="toggle-icon">{isOpen ? '▼' : '▲'}</span>
      </div>

      {isOpen && (
        <>
          <div className="logs-controls">
            <select
              value={filter.level || ''}
              onChange={(e) => setFilter(prev => ({ ...prev, level: e.target.value as LogLevel || undefined }))}
            >
              <option value="">All Levels</option>
              <option value="debug">🔍 Debug</option>
              <option value="info">ℹ️ Info</option>
              <option value="success">✅ Success</option>
              <option value="warn">⚠️ Warn</option>
              <option value="error">❌ Error</option>
            </select>

            <select
              value={filter.category || ''}
              onChange={(e) => setFilter(prev => ({ ...prev, category: e.target.value || undefined }))}
            >
              <option value="">All Categories</option>
              <option value="network">🌐 Network</option>
              <option value="ocr">📝 OCR</option>
              <option value="docker">🐳 Docker</option>
              <option value="system">⚙️ System</option>
              <option value="troubleshoot">🔧 Troubleshoot</option>
            </select>

            <label className="autoscroll-toggle">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>

            <button className="clear-btn" onClick={() => systemLogger.clear()}>
              🗑️ Clear
            </button>
          </div>

          <div className="logs-container">
            {filteredLogs.length === 0 ? (
              <div className="no-logs">No logs to display</div>
            ) : (
              filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className={`log-entry level-${log.level}`}
                  style={{ borderLeftColor: LEVEL_COLORS[log.level] }}
                >
                  <span className="log-time">{formatTime(log.timestamp)}</span>
                  <span className="log-icon">{LEVEL_ICONS[log.level]}</span>
                  <span className="log-category">{CATEGORY_BADGES[log.category]}</span>
                  <span className="log-message">{log.message}</span>
                  {log.details && (
                    <details className="log-details">
                      <summary>Details</summary>
                      <pre>{JSON.stringify(log.details, null, 2)}</pre>
                    </details>
                  )}
                  {log.stack && (
                    <details className="log-stack">
                      <summary>Stack Trace</summary>
                      <pre>{log.stack}</pre>
                    </details>
                  )}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </>
      )}
    </div>
  );
};

export default SystemLogsPanel;
