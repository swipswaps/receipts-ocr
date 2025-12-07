/**
 * Angle Detection Service
 * Uses Tesseract OSD (Orientation and Script Detection) via backend
 * to detect and correct text orientation in images.
 */

import { systemLogger } from './systemLogger';
import { API_BASE } from '../config';

interface RotationDetectionResult {
  success: boolean;
  orientation: number;
  confidence: number;
  correctionAngle: number;
  rotate: number;
}

/**
 * Detect image orientation using Tesseract OSD via backend.
 * Returns the detected orientation and the correction angle needed.
 */
export async function detectRotation(imageDataUrl: string): Promise<RotationDetectionResult> {
  try {
    systemLogger.info('ocr', 'Sending image for rotation detection...');

    // Extract base64 data from data URL
    const base64Data = imageDataUrl.includes(',')
      ? imageDataUrl.split(',')[1]
      : imageDataUrl;

    const response = await fetch(`${API_BASE}/detect-rotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Data }),
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const result = await response.json();

    systemLogger.info('ocr', `OSD result: orientation=${result.orientation}°, confidence=${result.confidence?.toFixed(2)}`);

    // Calculate correction angle
    // If Tesseract says text is at 90°, we need to rotate 270° (or -90°) to correct
    let correctionAngle = 0;
    if (result.orientation === 90) {
      correctionAngle = 270; // Rotate 270° CW (or 90° CCW)
    } else if (result.orientation === 180) {
      correctionAngle = 180;
    } else if (result.orientation === 270) {
      correctionAngle = 90; // Rotate 90° CW
    }

    return {
      success: result.success !== false,
      orientation: result.orientation || 0,
      confidence: result.confidence || 0,
      correctionAngle,
      rotate: result.rotate || 0,
    };
  } catch (error) {
    systemLogger.warn('ocr', `Rotation detection failed: ${error}`);
    return {
      success: false,
      orientation: 0,
      confidence: 0,
      correctionAngle: 0,
      rotate: 0,
    };
  }
}

/**
 * Rotate an image by a given angle using Canvas.
 * @param imageDataUrl - The image as a data URL
 * @param angle - Rotation angle in degrees (90, 180, 270)
 * @returns Promise with the rotated image data URL
 */
export async function rotateImage(imageDataUrl: string, angle: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (angle === 0) {
      resolve(imageDataUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      // For 90° or 270°, swap width and height
      if (angle === 90 || angle === 270) {
        canvas.width = img.height;
        canvas.height = img.width;
      } else {
        canvas.width = img.width;
        canvas.height = img.height;
      }

      // Move to center, rotate, draw, move back
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };

    img.onerror = () => reject(new Error('Failed to load image for rotation'));
    img.src = imageDataUrl;
  });
}

/**
 * Auto-detect and correct image rotation.
 * Only applies correction if confidence is above threshold.
 */
export async function autoCorrectRotation(
  imageDataUrl: string,
  confidenceThreshold = 0.3
): Promise<{ corrected: boolean; imageDataUrl: string; angle: number }> {
  const detection = await detectRotation(imageDataUrl);

  if (!detection.success || detection.confidence < confidenceThreshold) {
    systemLogger.info('ocr', 'Rotation detection: No correction needed or low confidence');
    return { corrected: false, imageDataUrl, angle: 0 };
  }

  if (detection.correctionAngle === 0) {
    systemLogger.info('ocr', 'Rotation detection: Image is upright');
    return { corrected: false, imageDataUrl, angle: 0 };
  }

  systemLogger.info('ocr', `Applying ${detection.correctionAngle}° rotation correction...`);
  const rotatedImage = await rotateImage(imageDataUrl, detection.correctionAngle);
  systemLogger.success('ocr', 'Rotation correction applied successfully');

  return { corrected: true, imageDataUrl: rotatedImage, angle: detection.correctionAngle };
}
