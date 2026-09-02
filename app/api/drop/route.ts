import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { generateCode } from '@/lib/code';
import { saveFile } from '@/lib/storage';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { recordUsage } from '@/lib/usage';
import { checkStorageQuota } from '@/lib/storageQuota';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB free-tier ceiling (MVP default)
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_RETRIEVALS_CAP = 50; // sanity cap regardless of what a client sends

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const note = (formData.get('note') as string) || null;
    const vertical = (formData.get('vertical') as string) || 'general';
    const requestedLimit = parseInt((formData.get('maxRetrievals') as string) || '5', 10);
    const maxRetrievals = Math.min(Math.max(requestedLimit || 5, 1), MAX_RETRIEVALS_CAP);

    if (files.length === 0 && !note) {
      return NextResponse.json({ error: 'Attach at least one file or a note' }, { status: 400 });
    }

    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${f.name} is over the 200MB free-tier limit` },
          { status: 413 }
        );
      }
    }

    const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
    const quota = checkStorageQuota(incomingBytes);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: 507 });
    }

    const dropId = crypto.randomUUID();
    const code = generateCode();
    const now = Date.now();
    const expiresAt = now + DEFAULT_EXPIRY_MS;

    db.prepare(
      `INSERT INTO drops (id, code, vertical, note, max_retrievals, retrieval_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(dropId, code, vertical, note, maxRetrievals, now, expiresAt);

    for (const f of files) {
      const buffer = Buffer.from(await f.arrayBuffer());
      const fileId = crypto.randomUUID();
      const { storagePath, sha256, sizeBytes } = await saveFile(buffer, dropId, fileId);

      db.prepare(
        `INSERT INTO files (id, drop_id, original_name, mime_type, size_bytes, sha256, storage_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(fileId, dropId, f.name, f.type || 'application/octet-stream', sizeBytes, sha256, storagePath);
    }

    const { deviceId, isNew } = getOrCreateDeviceId(req);
    recordUsage(hashDeviceGlobal(deviceId), 'drop');

    const res = NextResponse.json({
      code,
      expiresAt,
      maxRetrievals,
      fileCount: files.length,
    });

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
    return NextResponse.json({ error: 'Something went wrong while dropping your file' }, { status: 500 });
  }
}
