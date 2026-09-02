import crypto from 'crypto';
import db from './db';

/**
 * Codes are plain digits, no hyphen — fastest to type on a phone's numeric
 * keypad and easiest to read aloud, which matters at a print-shop counter or
 * PG entrance. Trade-off: a 6-digit numeric code has far less entropy than a
 * 6-character alphanumeric one (≈900k combinations vs ≈1B+), so it depends on
 * `checkRateLimit` (lib/rateLimit.ts) actually being enforced on every lookup
 * and download to stay safe against brute-forcing — do not remove that.
 * Standing codes (lib/standingCodes.ts) are longer (8 digits) since they live
 * indefinitely and are worth more to guess than a one-shot 24h drop.
 */
function randomDigits(len: number): string {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) {
    out += (bytes[i] % 10).toString();
  }
  // Avoid an all-leading-zero code purely for readability (e.g. "003921" reads
  // oddly out loud) — regenerate the first digit if it's zero.
  if (out[0] === '0') {
    out = ((crypto.randomBytes(1)[0] % 9) + 1).toString() + out.slice(1);
  }
  return out;
}

/** Generates a one-shot drop code, e.g. "482913". Retries on collision (rare). */
export function generateCode(length: 6 | 8 = 6): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomDigits(length);
    const existing = db
      .prepare('SELECT id FROM drops WHERE code = ? AND expires_at > ?')
      .get(code, Date.now());
    if (!existing) return code;
  }
  throw new Error('Could not generate a unique code, try again');
}

export function normalizeCode(input: string): string {
  return input.trim().replace(/[^0-9]/g, '');
}
