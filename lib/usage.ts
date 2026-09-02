import db from './db';

/**
 * Foundation for the paywall logic in MONETIZATION.md — no UI reads this yet.
 * Call recordUsage() on every drop and every successful retrieval so that
 * when the upgrade-prompt work starts, "has this device done this 4-5 times
 * this month" is already a cheap lookup instead of a new tracking system.
 * device_hash here should be a per-app device id (see lib/device.ts), not
 * tied to a specific drop the way retrievals.device_hash is.
 */
export function recordUsage(deviceHash: string, type: 'drop' | 'retrieve') {
  const now = Date.now();
  const existing = db.prepare('SELECT device_hash FROM device_usage WHERE device_hash = ?').get(deviceHash);

  if (!existing) {
    db.prepare(
      `INSERT INTO device_usage (device_hash, drop_count, retrieve_count, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(deviceHash, type === 'drop' ? 1 : 0, type === 'retrieve' ? 1 : 0, now, now);
    return;
  }

  const column = type === 'drop' ? 'drop_count' : 'retrieve_count';
  db.prepare(`UPDATE device_usage SET ${column} = ${column} + 1, last_seen_at = ? WHERE device_hash = ?`).run(
    now,
    deviceHash
  );
}

/** Total drops + retrievals for a device — the signal MONETIZATION.md's
 * "4th-5th use" upgrade-prompt trigger will read from once that UI exists. */
export function getUsage(deviceHash: string): { dropCount: number; retrieveCount: number } {
  const row = db
    .prepare('SELECT drop_count, retrieve_count FROM device_usage WHERE device_hash = ?')
    .get(deviceHash) as { drop_count: number; retrieve_count: number } | undefined;
  return { dropCount: row?.drop_count ?? 0, retrieveCount: row?.retrieve_count ?? 0 };
}
