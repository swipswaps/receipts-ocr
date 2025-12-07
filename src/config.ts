/**
 * Centralized configuration for the application
 * All services should import API_BASE from here instead of defining their own
 */

/**
 * Determines if the app is running on GitHub Pages (frontend-only demo)
 */
export const isGitHubPages =
  typeof window !== 'undefined' &&
  window.location.hostname.includes('github.io');

/**
 * Backend API base URL
 * - On GitHub Pages: Uses localhost (won't work, but gracefully falls back)
 * - On same host as backend: Uses localhost:5001
 * - On different host: Uses the current hostname with port 5001
 */
export const API_BASE =
  typeof window !== 'undefined'
    ? window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
      ? 'http://localhost:5001'
      : `http://${window.location.hostname}:5001`
    : 'http://localhost:5001';

/**
 * Default ports (can be overridden via .env)
 */
export const DEFAULT_VITE_PORT = 5173;
export const DEFAULT_BACKEND_PORT = 5001;
