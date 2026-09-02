import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { generateCode } from '@/lib/code';
import { getUploadUrl, isDirectUploadSupported } from '@/lib/storage';
import { checkStorageQuota } from '@/lib/storageQuota';

const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB free-tier ceiling (matches /api/drop)
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_RETRIEVALS_CAP = 50;

// Step 1 of the direct-to-R2 upload flow (see lib/storage.ts#getUploadUrl for
// why this exists — it's what makes uploads fast instead of routing every
// byte through Railway twice). The browser calls this FIRST with just file
// metadata (name/size/type, no bytes), gets back a presigned URL per file,
// PUTs each file straight to R2, then calls /api/drop/finalize to confirm.
//
// When R2 isn't configured (local dev without R2_* env vars), this responds
// with direct:false and no uploads — the client falls back to the old
// buffered POST /api/drop flow, so local dev keeps working unchanged.
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

    for (const f of filesMeta) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${f.name} is over the 200MB free-tier limit` },
          { status: 413 }
        );
      }
    }

    const incomingBytes = filesMeta.reduce((sum, f) => sum + f.size, 0);
    const quota = checkStorageQuota(incomingBytes);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: 507 });
    }

    // If R2 isn't configured (local dev), or this is a note-only drop with
    // nothing to presign, bail out with direct:false before creating any DB
    // rows — the client's fallback path (POST /api/drop) handles both cases.
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
      const uploadUrl = await getUploadUrl(key);

      db.prepare(
        `INSERT INTO files (id, drop_id, original_name, mime_type, size_bytes, sha256, storage_path, confirmed)
         VALUES (?, ?, ?, ?, ?, '', ?, 0)`
      ).run(fileId, dropId, f.name, f.type || 'application/octet-stream', f.size, key);

      uploads.push({ fileId, uploadUrl, key });
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
