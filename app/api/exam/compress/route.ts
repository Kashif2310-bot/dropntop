import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { generateCode } from '@/lib/code';
import { saveFile } from '@/lib/storage';
import { compressImageToTarget } from '@/lib/examCompress';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { recordUsage } from '@/lib/usage';
import { checkStorageQuota } from '@/lib/storageQuota';

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25MB in is plenty for a phone photo
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Compresses an image to an exact target KB (the thing dozens of India-only
// "compress to Xkb for govt form" tools exist to do), then immediately hands
// back a retrieve code for the result — so a student can grab the compressed
// file on a different device (a cyber café, a friend's laptop) without a
// second app. This is the actual wedge: no other tool we found does both
// steps in one flow.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const targetKB = parseInt((formData.get('targetKB') as string) || '', 10);

    if (!file) {
      return NextResponse.json({ error: 'Attach an image' }, { status: 400 });
    }
    if (file.size > MAX_INPUT_BYTES) {
      return NextResponse.json({ error: 'Image is too large (25MB max input)' }, { status: 413 });
    }
    if (!Number.isFinite(targetKB) || targetKB < 1 || targetKB > 5000) {
      return NextResponse.json({ error: 'Enter a target size between 1 and 5000 KB' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are supported right now (PDF compression is coming)' },
        { status: 415 }
      );
    }

    const inputBuffer = Buffer.from(await file.arrayBuffer());
    const { buffer, finalBytes, qualityUsed, hitFloor } = await compressImageToTarget(
      inputBuffer,
      targetKB * 1024
    );

    const quota = checkStorageQuota(finalBytes);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: 507 });
    }

    const dropId = crypto.randomUUID();
    const code = generateCode();
    const fileId = crypto.randomUUID();
    const now = Date.now();
    const compressedName = file.name.replace(/\.[^.]+$/, '') + '-compressed.jpg';

    const { storagePath, sha256, sizeBytes } = await saveFile(buffer, dropId, fileId);

    db.prepare(
      `INSERT INTO drops (id, code, vertical, note, max_retrievals, retrieval_count, created_at, expires_at)
       VALUES (?, ?, 'exam', NULL, 5, 0, ?, ?)`
    ).run(dropId, code, now, now + DEFAULT_EXPIRY_MS);

    db.prepare(
      `INSERT INTO files (id, drop_id, original_name, mime_type, size_bytes, sha256, storage_path)
       VALUES (?, ?, ?, 'image/jpeg', ?, ?, ?)`
    ).run(fileId, dropId, compressedName, sizeBytes, sha256, storagePath);

    const { deviceId, isNew } = getOrCreateDeviceId(req);
    recordUsage(hashDeviceGlobal(deviceId), 'drop');

    const res = NextResponse.json({
      code,
      finalKB: Math.round(finalBytes / 1024),
      targetKB,
      qualityUsed,
      hitFloor, // true = we couldn't quite hit the target even at lowest quality/scaled size
      expiresAt: now + DEFAULT_EXPIRY_MS,
    });

    if (isNew) {
      res.cookies.set(DEVICE_COOKIE_NAME, deviceId, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    }
    return res;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong while compressing your image' }, { status: 500 });
  }
}
