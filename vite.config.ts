import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Use repository name as base for GitHub Pages
  // Set to '/' for local development
  const base = mode === 'production' ? '/receipts-ocr/' : '/';

  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
    build: {
      sourcemap: false,
      minify: 'esbuild',
      target: 'es2020',
    },
  };
})
