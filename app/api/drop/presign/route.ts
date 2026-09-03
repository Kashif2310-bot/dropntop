import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { generateCode } from '@/lib/code';
import { getUploadUrl, isDirectUploadSupported } from '@/lib/storage';
import { checkStorageQuota } from '@/lib/storageQuota';

const MAX_FILES_PER_DROP = 20; // matches app/drop/page.tsx's MAX_FILES — a
// gallery grid past this stops being "browse and pick the good ones" and
// starts being its own version of the WhatsApp clutter problem.
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024; // 2GB per file — this is the direct-to-R2
// path (browser -> R2 straight, never through this server), so a large file
// costs Railway nothing but a small JSON request either way. The old 200MB
// number stays on the legacy buffered /api/drop route (server-buffered, only
// used for local dev / note-only drops), which genuinely cannot handle files
// this large without exhausting server memory.
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_RETRIEVALS_CAP = 50;
const UPLOAD_URL_EXPIRY_SECONDS = 60 * 60; // 1h — a 2GB upload on a slow connection
// can take a while; the previous 15-minute default was tuned for small files.

function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType.startsWith('video/');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filesMeta = (body.files || []) as { name: string; size: number; type: string }[];
    const note = body.note || null;
    const vertical = body.vertical || 'general';
    const requestedLimit = parseInt(body.maxRetrievals || '5', 10);
    const maxRetrievals = Math.min(Math.max(requestedLimit || 5, 1), MAX_RETRIEVALS_CAP);

    if (filesMeta.length === 0 && !note) {
      return NextResponse.json({ error: 'Attach at least one file or a note' }, { status: 400 });
    }

    if (filesMeta.length > MAX_FILES_PER_DROP) {
      return NextResponse.json(
        { error: `You can drop up to ${MAX_FILES_PER_DROP} files at a time` },
        { status: 413 }
      );
    }

    for (const f of filesMeta) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${f.name} is over the 2GB per-file limit` },
          { status: 413 }
        );
      }
    }

    const incomingBytes = filesMeta.reduce((sum, f) => sum + f.size, 0);
    const quota = checkStorageQuota(incomingBytes);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: 507 });
    }

    if (filesMeta.length === 0 || !isDirectUploadSupported()) {
      return NextResponse.json({ direct: false });
    }

    const dropId = crypto.randomUUID();
    const code = generateCode();
    const now = Date.now();
    const expiresAt = now + DEFAULT_EXPIRY_MS;

    db.prepare(
      `INSERT INTO drops (id, code, vertical, note, max_retrievals, retrieval_count, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(dropId, code, vertical, note, maxRetrievals, now, expiresAt);

    const uploads = [];
    for (const f of filesMeta) {
      const fileId = crypto.randomUUID();
      const key = `${dropId}__${fileId}`;
      const uploadUrl = await getUploadUrl(key, UPLOAD_URL_EXPIRY_SECONDS);

      const mimeType = f.type || 'application/octet-stream';
      const previewable = isPreviewable(mimeType);
      const thumbKey = previewable ? `${key}__thumb` : null;
      const thumbnailUploadUrl = thumbKey ? await getUploadUrl(thumbKey, UPLOAD_URL_EXPIRY_SECONDS) : null;

      db.prepare(
        `INSERT INTO files (id, drop_id, original_name, mime_type, size_bytes, sha256, storage_path, confirmed, thumbnail_path, has_thumbnail)
         VALUES (?, ?, ?, ?, ?, '', ?, 0, ?, 0)`
      ).run(fileId, dropId, f.name, mimeType, f.size, key, thumbKey);

      uploads.push({ fileId, uploadUrl, key, thumbnailUploadUrl });
    }

    return NextResponse.json({
      direct: true,
      dropId,
      code,
      expiresAt,
      maxRetrievals,
      uploads,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong while preparing your drop' }, { status: 500 });
  }
}
