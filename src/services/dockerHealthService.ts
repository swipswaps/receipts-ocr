/**
 * Docker Health Monitoring Service
 * Monitors connection to the receipts-ocr backend container
 */

export interface DockerHealthStatus {
  isHealthy: boolean;
  isAvailable: boolean;
  lastChecked: Date;
  error?: string;
  retryCount: number;
  ocrEngine?: string;
  database?: string;
}

const API_BASE = 'http://localhost:5001';

class DockerHealthService {
  private healthStatus: DockerHealthStatus = {
    isHealthy: false,
    isAvailable: false,
    lastChecked: new Date(),
    retryCount: 0,
  };

  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 10000;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY_MS = 2000;

  // Pause health checks during active OCR to prevent false negatives
  private isPaused = false;

  /**
   * Start monitoring Docker health
   */
  startMonitoring(onStatusChange?: (status: DockerHealthStatus) => void): void {
    this.checkHealth().then(onStatusChange);

    if (!this.checkInterval) {
      this.checkInterval = setInterval(async () => {
        // Skip health checks while OCR is processing (backend is busy, not dead)
        if (this.isPaused) {
          return;
        }
        const status = await this.checkHealth();
        onStatusChange?.(status);
      }, this.CHECK_INTERVAL_MS);
    }
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Pause health checks during active OCR processing
   * Prevents false negatives when backend is busy processing large images
   */
  pauseMonitoring(): void {
    this.isPaused = true;
  }

  /**
   * Resume health checks after OCR processing completes
   */
  resumeMonitoring(): void {
    this.isPaused = false;
  }

  /**
   * Check Docker health with retry
   */
  async checkHealth(): Promise<DockerHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        this.healthStatus = {
          isHealthy: data.status === 'healthy',
          isAvailable: true,
          lastChecked: new Date(),
          retryCount: 0,
          ocrEngine: data.ocr_engine,
          database: data.database,
        };
        return this.healthStatus;
      }
    } catch (error) {
      return this.handleFailure(error);
    }

    return this.healthStatus;
  }

  private async handleFailure(error: unknown): Promise<DockerHealthStatus> {
    this.healthStatus.retryCount++;
    this.healthStatus.isHealthy = false;
    this.healthStatus.lastChecked = new Date();
    this.healthStatus.error = error instanceof Error ? error.message : 'Connection failed';

    if (this.healthStatus.retryCount <= this.MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, this.RETRY_DELAY_MS));
      return this.checkHealth();
    }

    this.healthStatus.isAvailable = false;
    console.warn('⚠️ Docker backend unavailable. Falling back to Tesseract.js');
    return this.healthStatus;
  }

  /**
   * Get current status
   */
  getStatus(): DockerHealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Force a health check
   */
  async forceCheck(): Promise<DockerHealthStatus> {
    this.healthStatus.retryCount = 0;
    return this.checkHealth();
  }

  /**
   * Get setup instructions based on platform
   */
  getSetupInstructions(): { platform: string; steps: string[] } {
    const ua = navigator.userAgent.toLowerCase();
    const isWindows = ua.includes('win');
    const isMac = ua.includes('mac');

    if (isWindows) {
      return {
        platform: 'Windows',
        steps: [
          'Open PowerShell as Administrator',
          'cd path\\to\\receipts-ocr',
          'docker compose up -d',
          'Wait 60 seconds for PaddleOCR to initialize',
          'Refresh this page',
        ],
      };
    } else if (isMac) {
      return {
        platform: 'macOS',
        steps: [
          'Open Terminal',
          'cd /path/to/receipts-ocr',
          'docker compose up -d',
          'Wait 60 seconds for PaddleOCR to initialize',
          'Refresh this page',
        ],
      };
    } else {
      return {
        platform: 'Linux',
        steps: [
          'Open Terminal',
          'cd /path/to/receipts-ocr',
          'docker compose up -d',
          'Wait 60 seconds for PaddleOCR to initialize',
          'Refresh this page',
        ],
      };
    }
  }
}

export const dockerHealthService = new DockerHealthService();
