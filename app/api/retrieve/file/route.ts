import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { normalizeCode } from '@/lib/code';
import { readFile } from '@/lib/storage';
import { getOrCreateDeviceId, hashDevice, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { checkRateLimit } from '@/lib/rateLimit';
import { recordUsage } from '@/lib/usage';

// Streams the actual file bytes back, verified against the sha256 recorded at
// upload time so the response can carry an integrity header. This is what
// "zero quality loss" means in practice: we never touch the bytes after
// saveFile() writes them, and we prove it on the way out.
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`download:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const code = normalizeCode(searchParams.get('code') || '');
  const fileId = searchParams.get('fileId') || '';

  const drop = db.prepare('SELECT * FROM drops WHERE code = ?').get(code) as any;
  if (!drop) return NextResponse.json({ error: 'No drop found for that code' }, { status: 404 });
  if (drop.expires_at < Date.now()) {
    return NextResponse.json({ error: 'This code has expired' }, { status: 410 });
  }

  const file = db
    .prepare('SELECT * FROM files WHERE id = ? AND drop_id = ?')
    .get(fileId, drop.id) as any;
  if (!file) return NextResponse.json({ error: 'File not found in this drop' }, { status: 404 });

  const { deviceId, isNew } = getOrCreateDeviceId(req);
  const deviceHash = hashDevice(deviceId, drop.id);
  const alreadyRetrieved = db
    .prepare('SELECT id FROM retrievals WHERE drop_id = ? AND device_hash = ?')
    .get(drop.id, deviceHash);

  if (!alreadyRetrieved) {
    if (drop.retrieval_count >= drop.max_retrievals) {
      return NextResponse.json(
        { error: 'This code has reached its access limit set by the sender' },
        { status: 403 }
      );
    }
    db.prepare(
      'INSERT INTO retrievals (id, drop_id, retrieved_at, device_hash) VALUES (?, ?, ?, ?)'
    ).run(crypto.randomUUID(), drop.id, Date.now(), deviceHash);
    db.prepare('UPDATE drops SET retrieval_count = retrieval_count + 1 WHERE id = ?').run(drop.id);
    recordUsage(hashDeviceGlobal(deviceId), 'retrieve');
  }

  const buffer = readFile(file.storage_path);
  const verifySha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const res = new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': file.mime_type,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`,
      'Content-Length': String(file.size_bytes),
      'X-Checksum-SHA256': verifySha256,
      'X-Checksum-Match': String(verifySha256 === file.sha256),
    },
  });

  if (isNew) {
    res.cookies.set(DEVICE_COOKIE_NAME, deviceId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return res;
}
