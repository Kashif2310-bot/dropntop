import db from './db';
import { deleteFile } from './storage';

/**
 * Purges every file belonging to an expired drop from storage, then deletes
 * the drop row (files/retrievals cascade via ON DELETE CASCADE). Expiry
 * already blocks retrieval — this is what actually reclaims disk/storage
 * space, which matters once storage is a real cost (R2 in production).
 * Standing-code submissions expire too (30 days, see app/api/standing/drop)
 * so this same job cleans those up as well — nothing standing-code-specific
 * needed here.
 */
const ABANDONED_UPLOAD_MS = 60 * 60 * 1000; // 1 hour

export async function purgeExpired(): Promise<{ dropsDeleted: number; filesDeleted: number }> {
  const now = Date.now();
  const expiredDrops = db.prepare('SELECT id FROM drops WHERE expires_at < ?').all(now) as { id: string }[];

  // Direct-to-R2 uploads (see /api/drop/presign) create the drop+file rows
  // BEFORE the browser has actually uploaded anything, then confirm them in
  // /api/drop/finalize once the upload completes. If someone closes the tab
  // mid-upload, that finalize call never happens — this sweeps up those
  // half-created drops after an hour so they don't sit around counting
  // toward the storage quota (lib/storageQuota.ts) forever for files that
  // may not even exist in R2.
  const abandonedDrops = db
    .prepare(
      `SELECT DISTINCT drops.id FROM drops
       JOIN files ON files.drop_id = drops.id
       WHERE files.confirmed = 0 AND drops.created_at < ?`
    )
    .all(now - ABANDONED_UPLOAD_MS) as { id: string }[];

  const dropsToPurge = [...expiredDrops, ...abandonedDrops];

  let filesDeleted = 0;
  const fileStmt = db.prepare('SELECT storage_path FROM files WHERE drop_id = ?');
  const deleteDropStmt = db.prepare('DELETE FROM drops WHERE id = ?');

  for (const drop of dropsToPurge) {
    const files = fileStmt.all(drop.id) as { storage_path: string }[];
    for (const f of files) {
      await deleteFile(f.storage_path).catch(() => {}); // object may never have actually landed in R2
      filesDeleted++;
    }
    deleteDropStmt.run(drop.id); // cascades to files + retrievals rows
  }

  return { dropsDeleted: dropsToPurge.length, filesDeleted };
}
