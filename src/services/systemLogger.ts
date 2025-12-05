/**
 * System Logger Service
 * Centralized logging for all system events, network requests, and diagnostics
 */

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error' | 'system';

export interface SystemLogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: 'network' | 'ocr' | 'docker' | 'system' | 'user' | 'troubleshoot';
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
}

type LogListener = (entry: SystemLogEntry) => void;

class SystemLogger {
  private logs: SystemLogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxLogs = 500;
  private idCounter = 0;

  constructor() {
    // Intercept fetch to log all network requests
    this.interceptFetch();
  }

  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  private interceptFetch(): void {
    const originalFetch = window.fetch;
    const logFn = this.log.bind(this);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method || 'GET';
      const startTime = Date.now();

      logFn('debug', 'network', `→ ${method} ${url}`, { method, url });

      try {
        const response = await originalFetch.call(window, input, init);
        const duration = Date.now() - startTime;

        if (response.ok) {
          logFn('info', 'network', `← ${response.status} ${url} (${duration}ms)`, {
            status: response.status,
            duration,
            url
          });
        } else {
          logFn('warn', 'network', `← ${response.status} ${response.statusText} ${url} (${duration}ms)`, {
            status: response.status,
            statusText: response.statusText,
            duration,
            url
          });
        }

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;
        const msg = error instanceof Error ? error.message : 'Network error';
        logFn('error', 'network', `✗ ${method} ${url} failed: ${msg} (${duration}ms)`, {
          error: msg,
          duration,
          url
        });
        throw error;
      }
    };
  }

  private lastMessage: string | null = null;
  private lastMessageCount: number = 0;
  private lastMessageId: string | null = null;

  log(
    level: LogLevel,
    category: SystemLogEntry['category'],
    message: string,
    details?: Record<string, unknown>,
    stack?: string
  ): void {
    const messageKey = `${level}:${category}:${message}`;

    // Check for repeated message
    if (messageKey === this.lastMessage && this.lastMessageId) {
      this.lastMessageCount++;
      // Update the last entry's message to show count
      const lastEntry = this.logs.find(l => l.id === this.lastMessageId);
      if (lastEntry) {
        lastEntry.message = `${message} (×${this.lastMessageCount})`;
        lastEntry.timestamp = new Date(); // Update timestamp
        // Notify listeners of update
        this.listeners.forEach(listener => listener(lastEntry));
      }
      return;
    }

    // New message - reset counter
    this.lastMessage = messageKey;
    this.lastMessageCount = 1;

    const entry: SystemLogEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      level,
      category,
      message,
      details,
      stack
    };

    this.lastMessageId = entry.id;
    this.logs.push(entry);

    // Trim old logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Notify listeners
    this.listeners.forEach(listener => listener(entry));
  }

  // Convenience methods
  debug(category: SystemLogEntry['category'], message: string, details?: Record<string, unknown>): void {
    this.log('debug', category, message, details);
  }

  info(category: SystemLogEntry['category'], message: string, details?: Record<string, unknown>): void {
    this.log('info', category, message, details);
  }

  success(category: SystemLogEntry['category'], message: string, details?: Record<string, unknown>): void {
    this.log('success', category, message, details);
  }

  warn(category: SystemLogEntry['category'], message: string, details?: Record<string, unknown>): void {
    this.log('warn', category, message, details);
  }

  error(category: SystemLogEntry['category'], message: string, details?: Record<string, unknown>, stack?: string): void {
    this.log('error', category, message, details, stack);
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLogs(filter?: { level?: LogLevel; category?: SystemLogEntry['category']; limit?: number }): SystemLogEntry[] {
    let result = [...this.logs];
    if (filter?.level) result = result.filter(l => l.level === filter.level);
    if (filter?.category) result = result.filter(l => l.category === filter.category);
    if (filter?.limit) result = result.slice(-filter.limit);
    return result;
  }

  clear(): void {
    this.logs = [];
    this.listeners.forEach(listener => listener({
      id: this.generateId(),
      timestamp: new Date(),
      level: 'system',
      category: 'system',
      message: 'Logs cleared'
    }));
  }
}

export const systemLogger = new SystemLogger();
