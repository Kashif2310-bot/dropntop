import db from './db';

const SAFE_LIMIT_BYTES = 9 * 1024 * 1024 * 1024; // 9GB — 1GB headroom below R2's 10GB free tier

export function getTotalStorageBytes(): number {
  const row = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as total FROM files').get() as {
    total: number;
  };
  return row.total;
}

export function checkStorageQuota(incomingBytes: number): { ok: boolean; error?: string } {
  const currentTotal = getTotalStorageBytes();
  if (currentTotal + incomingBytes > SAFE_LIMIT_BYTES) {
    return {
      ok: false,
      error:
        "We're temporarily full — storage is at capacity. Please try again in a little while (older drops expire and free up space automatically).",
    };
  }
  return { ok: true };
}
