// Client-only (uses DOM/canvas/video APIs) — import this only from 'use
// client' components. Generates a small JPEG preview entirely in the
// browser, so a gallery of thumbnails never requires the server to touch
// full-size originals just to show a preview.

const THUMB_MAX_DIMENSION = 480;
const THUMB_QUALITY = 0.6;
const VIDEO_THUMBNAIL_TIMEOUT_MS = 15000;

function scaleDown(width: number, height: number): { width: number; height: number } {
  if (!width || !height) return { width: THUMB_MAX_DIMENSION, height: THUMB_MAX_DIMENSION };
  const scale = Math.min(1, THUMB_MAX_DIMENSION / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', THUMB_QUALITY));
}

export async function generateImageThumbnail(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaleDown(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return await canvasToBlob(canvas);
  } catch {
    return null;
  }
}

export function generateVideoThumbnail(
  file: File
): Promise<{ blob: Blob | null; durationSeconds: number | null }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;

    let settled = false;
    const cleanup = () => URL.revokeObjectURL(url);
    const finish = (result: { blob: Blob | null; durationSeconds: number | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      resolve(result);
    };

    const timeout = setTimeout(() => finish({ blob: null, durationSeconds: null }), VIDEO_THUMBNAIL_TIMEOUT_MS);

    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      video.currentTime = Math.min(1, (duration || 1) * 0.1);
    });

    video.addEventListener('seeked', async () => {
      try {
        const { width, height } = scaleDown(video.videoWidth, video.videoHeight);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return finish({ blob: null, durationSeconds: null });
        ctx.drawImage(video, 0, 0, width, height);
        const blob = await canvasToBlob(canvas);
        finish({ blob, durationSeconds: Number.isFinite(video.duration) ? video.duration : null });
      } catch {
        finish({ blob: null, durationSeconds: null });
      }
    });

    video.addEventListener('error', () => finish({ blob: null, durationSeconds: null }));
  });
}
