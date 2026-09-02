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
export function purgeExpired(): { dropsDeleted: number; filesDeleted: number } {
  const now = Date.now();
  const expiredDrops = db.prepare('SELECT id FROM drops WHERE expires_at < ?').all(now) as { id: string }[];

  let filesDeleted = 0;
  const fileStmt = db.prepare('SELECT storage_path FROM files WHERE drop_id = ?');
  const deleteDropStmt = db.prepare('DELETE FROM drops WHERE id = ?');

  for (const drop of expiredDrops) {
    const files = fileStmt.all(drop.id) as { storage_path: string }[];
    for (const f of files) {
      deleteFile(f.storage_path);
      filesDeleted++;
    }
    deleteDropStmt.run(drop.id); // cascades to files + retrievals rows
  }

  return { dropsDeleted: expiredDrops.length, filesDeleted };
}
