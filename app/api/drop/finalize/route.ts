import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { headFile, deleteFile } from '@/lib/storage';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { recordUsage } from '@/lib/usage';

// Step 2 of the direct-to-R2 upload flow — called once the browser has
// finished PUTting every file straight to R2 (see /api/drop/presign). For
// each file we confirm with R2 itself that the object really exists (never
// trust that the browser's PUT actually succeeded) and record the actual
// size R2 reports, not whatever the browser claimed before uploading.
//
// The sha256 for each file comes from the browser too (computed client-side
// via the Web Crypto API before/while uploading) since this server never
// sees the raw bytes on this path — that's the whole point. If any file
// fails to confirm, the entire drop is torn down rather than left half-done,
// so a code is never handed out for a drop with missing files.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dropId = body.dropId as string;
    const files = (body.files || []) as { fileId: string; sha256: string }[];

    const drop = db.prepare('SELECT * FROM drops WHERE id = ?').get(dropId) as any;
    if (!drop) return NextResponse.json({ error: 'Drop not found' }, { status: 404 });

    const dbFiles = db.prepare('SELECT * FROM files WHERE drop_id = ?').all(dropId) as any[];

    for (const dbFile of dbFiles) {
      const clientInfo = files.find((f) => f.fileId === dbFile.id);
      const head = await headFile(dbFile.storage_path);

      if (!clientInfo || !head.exists) {
        // Upload never completed for this file — tear the whole drop down
        // rather than hand out a code for a drop missing a file.
        for (const f of dbFiles) {
          if (f.confirmed || f.id === dbFile.id) await deleteFile(f.storage_path).catch(() => {});
        }
        db.prepare('DELETE FROM drops WHERE id = ?').run(dropId); // cascades files/retrievals
        return NextResponse.json(
          { error: `Upload for "${dbFile.original_name}" did not complete — please try again` },
          { status: 400 }
        );
      }

      db.prepare('UPDATE files SET sha256 = ?, size_bytes = ?, confirmed = 1 WHERE id = ?').run(
        clientInfo.sha256,
        head.sizeBytes ?? dbFile.size_bytes,
        dbFile.id
      );
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
