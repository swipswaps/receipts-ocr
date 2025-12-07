/**
 * Backend Log Service
 * Streams real-time logs from the Docker backend during OCR processing
 * Issue #27: Backend logs not streamed to frontend
 */

import { API_BASE } from '../config';

export interface BackendLog {
  timestamp: number;
  level: string;
  message: string;
}

type LogCallback = (log: BackendLog) => void;

class BackendLogService {
  private eventSource: EventSource | null = null;
  private listeners: Set<LogCallback> = new Set();
  private isStreaming = false;

  /**
   * Start streaming logs from backend via Server-Sent Events
   */
  startStreaming(): void {
    if (this.isStreaming || this.eventSource) {
      return;
    }

    try {
      this.eventSource = new EventSource(`${API_BASE}/logs/stream`);
      this.isStreaming = true;

      this.eventSource.onmessage = (event) => {
        try {
          const log: BackendLog = JSON.parse(event.data);
          this.notifyListeners(log);
        } catch (e) {
          console.warn('Failed to parse backend log:', e);
        }
      };

      this.eventSource.onerror = () => {
        // SSE connection failed - backend might be busy or unavailable
        // Don't log this as it's expected during heavy OCR processing
        this.stopStreaming();
      };
    } catch (e) {
      console.warn('Failed to start log streaming:', e);
    }
  }

  /**
   * Stop streaming logs
   */
  stopStreaming(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.isStreaming = false;
  }

  /**
   * Subscribe to log updates
   */
  subscribe(callback: LogCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Poll for logs since a timestamp (fallback if SSE fails)
   */
  async pollLogs(since: number = 0): Promise<BackendLog[]> {
    try {
      const response = await fetch(`${API_BASE}/logs?since=${since}`);
      if (response.ok) {
        const data = await response.json();
        return data.logs || [];
      }
    } catch {
      // Backend unavailable - expected during startup
    }
    return [];
  }

  private notifyListeners(log: BackendLog): void {
    this.listeners.forEach((callback) => {
      try {
        callback(log);
      } catch (e) {
        console.warn('Log listener error:', e);
      }
    });
  }
}

export const backendLogService = new BackendLogService();
