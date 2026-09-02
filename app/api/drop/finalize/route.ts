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

    for (const dbFile of dbFiles) {
      const clientInfo = files.find((f) => f.fileId === dbFile.id);
      const head = await headFile(dbFile.storage_path);

      if (!clientInfo || !head.exists) {
        for (const f of dbFiles) {
          if (f.confirmed || f.id === dbFile.id) await deleteFile(f.storage_path).catch(() => {});
        }
        db.prepare('DELETE FROM drops WHERE id = ?').run(dropId);
        return NextResponse.json(
          { error: `Upload for "${dbFile.original_name}" did not complete — please try again` },
          { status: 400 }
        );
      }

      db.prepare('UPDATE files SET sha256 = ?, size_bytes = ?, confirmed = 1, duration_seconds = ? WHERE id = ?').run(
        clientInfo.sha256,
        head.sizeBytes ?? dbFile.size_bytes,
        clientInfo.durationSeconds ?? null,
        dbFile.id
      );

      if (dbFile.thumbnail_path && clientInfo.thumbnailUploaded) {
        const thumbHead = await headFile(dbFile.thumbnail_path);
        if (thumbHead.exists) {
          db.prepare('UPDATE files SET has_thumbnail = 1 WHERE id = ?').run(dbFile.id);
        }
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
