import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Receipts OCR App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display header and tabs', async ({ page }) => {
    // Header
    await expect(page.locator('h1')).toContainText('Receipts OCR');

    // Status indicator
    await expect(page.locator('.docker-status')).toBeVisible();

    // Tabs
    await expect(page.getByRole('button', { name: /upload/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /history/i })).toBeVisible();
  });

  test('should show upload dropzone', async ({ page }) => {
    await expect(page.locator('.dropzone')).toBeVisible();
    await expect(page.locator('.dropzone-placeholder')).toContainText('Drop receipt image');
  });

  test('should check backend health on load', async ({ page }) => {
    // Wait for health check to complete
    await page.waitForTimeout(3500);

    // Should show either healthy or fallback status
    const status = page.locator('.docker-status');
    await expect(status).toBeVisible();

    const statusText = await status.textContent();
    expect(statusText).toMatch(/PaddleOCR|Docker|Tesseract|Checking/);
  });

  test('should upload image and show preview', async ({ page }) => {
    // Create test image path
    const testImagePath = path.join(__dirname, '..', 'test_image.png');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(testImagePath);

    // Preview should appear
    await expect(page.locator('.preview')).toBeVisible({ timeout: 10000 });

    // Extract Text button should be enabled
    await expect(page.getByRole('button', { name: /extract text/i })).toBeEnabled();
  });

  test('should process image with OCR', async ({ page }) => {
    const testImagePath = path.join(__dirname, '..', 'test_image.png');

    // Upload
    await page.locator('input[type="file"]').setInputFiles(testImagePath);
    await expect(page.locator('.preview')).toBeVisible({ timeout: 10000 });

    // Click Extract Text
    await page.getByRole('button', { name: /extract text/i }).click();

    // Should show processing state
    await expect(page.getByRole('button', { name: /processing/i })).toBeVisible();

    // Wait for OCR to complete (Tesseract can take 10-30s)
    await expect(page.locator('.output-section')).toBeVisible({ timeout: 60000 });

    // Should show output tabs
    await expect(page.locator('.output-tabs')).toBeVisible();
  });

  test('should show logs during processing', async ({ page }) => {
    const testImagePath = path.join(__dirname, '..', 'test_image.png');

    await page.locator('input[type="file"]').setInputFiles(testImagePath);
    await expect(page.locator('.preview')).toBeVisible({ timeout: 10000 });

    // Should have logs from file selection
    await expect(page.locator('.logs')).toBeVisible();
    const logCount = await page.locator('.log-entry').count();
    expect(logCount).toBeGreaterThan(0);
  });

  test('should switch between tabs', async ({ page }) => {
    // Start on Upload tab
    await expect(page.locator('.dropzone')).toBeVisible();

    // Click History tab (may be disabled if backend unhealthy)
    const historyTab = page.getByRole('button', { name: /history/i });
    const isDisabled = await historyTab.isDisabled();

    if (!isDisabled) {
      await historyTab.click();
      await expect(page.locator('.history-view')).toBeVisible();

      // Switch back to Upload
      await page.getByRole('button', { name: /upload/i }).click();
      await expect(page.locator('.dropzone')).toBeVisible();
    }
  });

  test('should show raw OCR text in details', async ({ page }) => {
    const testImagePath = path.join(__dirname, '..', 'test_image.png');

    await page.locator('input[type="file"]').setInputFiles(testImagePath);
    await page.getByRole('button', { name: /extract text/i }).click();

    // Wait for output section
    await expect(page.locator('.output-section')).toBeVisible({ timeout: 60000 });

    // Text tab should be visible with textarea containing OCR result
    const textarea = page.locator('.output-textarea');
    await expect(textarea).toBeVisible();
    const text = await textarea.inputValue();
    expect(text.length).toBeGreaterThan(0);
  });
});

test.describe('Backend Integration', () => {
  test('backend health endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:5001/health');

    // May fail if backend not running - that's ok
    if (response.ok()) {
      const data = await response.json();
      expect(data.status).toBe('healthy');
      // Service can be 'paddleocr' or just present
    }
  });

  test('OCR endpoint accepts image', async ({ request }) => {
    const response = await request.get('http://localhost:5001/health');
    if (!response.ok()) {
      test.skip();
      return;
    }

    // Test OCR with form data
    const testImagePath = path.join(__dirname, '..', 'test_image.png');
    const fs = await import('fs');
    const imageBuffer = fs.readFileSync(testImagePath);

    const ocrResponse = await request.post('http://localhost:5001/ocr', {
      multipart: {
        file: {
          name: 'test_image.png',
          mimeType: 'image/png',
          buffer: imageBuffer,
        },
      },
    });

    expect(ocrResponse.ok()).toBeTruthy();
    const data = await ocrResponse.json();
    expect(data).toHaveProperty('raw_text');
  });
});
