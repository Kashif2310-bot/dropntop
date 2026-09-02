import sharp from 'sharp';

// Server-only compression logic. See lib/examPresets.ts for the preset list
// (kept separate so client components can import presets without pulling
// this file's `sharp` dependency into the browser bundle).

/**
 * Binary-searches JPEG quality (1-100) to land at or under targetBytes.
 * Only handles raster images (jpg/png/webp/etc via sharp) — PDFs need a
 * different pipeline (pdf-lib/ghostscript re-rasterizing each page) and
 * aren't implemented yet; see CLAUDE.md.
 */
export async function compressImageToTarget(
  input: Buffer,
  targetBytes: number
): Promise<{ buffer: Buffer; qualityUsed: number; finalBytes: number; hitFloor: boolean }> {
  let low = 1;
  let high = 95;
  let best: Buffer | null = null;
  let bestQuality = low;

  // A handful of iterations is enough to converge tightly on an 8-bit quality scale.
  for (let i = 0; i < 8; i++) {
    const mid = Math.round((low + high) / 2);
    const candidate = await sharp(input).jpeg({ quality: mid, mozjpeg: true }).toBuffer();

    if (candidate.length <= targetBytes) {
      best = candidate;
      bestQuality = mid;
      low = mid + 1; // try to use more of the budget, closer to targetBytes
    } else {
      high = mid - 1;
    }
    if (low > high) break;
  }

  if (best) {
    return { buffer: best, qualityUsed: bestQuality, finalBytes: best.length, hitFloor: false };
  }

  // Even quality=1 didn't fit — downscale dimensions and retry once at quality=1.
  const meta = await sharp(input).metadata();
  const scaled = await sharp(input)
    .resize({ width: Math.round((meta.width || 800) * 0.6) })
    .jpeg({ quality: 1, mozjpeg: true })
    .toBuffer();

  return { buffer: scaled, qualityUsed: 1, finalBytes: scaled.length, hitFloor: scaled.length > targetBytes };
}
