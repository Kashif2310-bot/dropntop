import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { headFile, deleteFile } from '@/lib/storage';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { recordUsage } from '@/lib/usage';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dropId = body.dropId as string;
    const files = (body.files || []) as {
      fileId: string;
      sha256: string;
      thumbnailUploaded?: boolean;
      durationSeconds?: number;
    }[];

    const drop = db.prepare('SELECT * FROM drops WHERE id = ?').get(dropId) as any;
    if (!drop) return NextResponse.json({ error: 'Drop not found' }, { status: 404 });

    const dbFiles = db.prepare('SELECT * FROM files WHERE drop_id = ?').all(dropId) as any[];

    // HEAD-check every original + thumbnail against R2 IN PARALLEL rather
    // than one-by-one — with up to 20 files in a drop, a sequential loop of
    // network round-trips here was the single biggest reason a large batch
    // felt "stuck" or timed out even though every upload had actually
    // succeeded. This only fans out the read-only existence checks; the
    // actual DB writes below stay sequential (better-sqlite3 is synchronous
    // and a single connection anyway, so there's nothing to gain there).
    const checks = await Promise.all(
      dbFiles.map(async (dbFile) => {
        const clientInfo = files.find((f) => f.fileId === dbFile.id);
        const head = await headFile(dbFile.storage_path);
        const thumbHead =
          dbFile.thumbnail_path && clientInfo?.thumbnailUploaded ? await headFile(dbFile.thumbnail_path) : null;
        return { dbFile, clientInfo, head, thumbHead };
      })
    );

    const missing = checks.find((c) => !c.clientInfo || !c.head.exists);
    if (missing) {
      // Upload never completed for at least one file — tear the whole drop
      // down rather than hand out a code for a drop missing a file.
      await Promise.all(
        dbFiles.map((f) => (f.confirmed || f.id === missing.dbFile.id ? deleteFile(f.storage_path).catch(() => {}) : null))
      );
      db.prepare('DELETE FROM drops WHERE id = ?').run(dropId); // cascades files/retrievals
      return NextResponse.json(
        { error: `Upload for "${missing.dbFile.original_name}" did not complete — please try again` },
        { status: 400 }
      );
    }

    for (const { dbFile, clientInfo, head, thumbHead } of checks) {
      db.prepare('UPDATE files SET sha256 = ?, size_bytes = ?, confirmed = 1, duration_seconds = ? WHERE id = ?').run(
        clientInfo!.sha256,
        head.sizeBytes ?? dbFile.size_bytes,
        clientInfo!.durationSeconds ?? null,
        dbFile.id
      );

      // The thumbnail is a nice-to-have, not integrity-critical the way the
      // original file is — a missing/failed thumbnail never tears down the
      // drop, it just means that tile falls back to a generic icon in the
      // retrieve grid.
      if (thumbHead?.exists) {
        db.prepare('UPDATE files SET has_thumbnail = 1 WHERE id = ?').run(dbFile.id);
      }
    }

    const { deviceId, isNew } = getOrCreateDeviceId(req);
    recordUsage(hashDeviceGlobal(deviceId), 'drop');

    const res = NextResponse.json({ ok: true });
    if (isNew) {
      res.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong finishing your drop' }, { status: 500 });
  }
}
