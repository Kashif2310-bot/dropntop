import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { generateCode, normalizeCode } from '@/lib/code';
import { saveFile } from '@/lib/storage';
import { getStandingCodeByCode } from '@/lib/standingCodes';
import { checkStorageQuota } from '@/lib/storageQuota';

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const SUBMISSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — owner has time to collect it

// Drops a file INTO an existing standing code (a PG's or print shop's
// permanent code), rather than minting a new retrieve code for the sender.
// The sender gets a confirmation, not a code — only the standing code's
// owner (via /api/standing/dashboard, PIN-gated) can see and download it.
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const standingCode = normalizeCode((formData.get('standingCode') as string) || '');
    const files = formData.getAll('files') as File[];
    const note = (formData.get('note') as string) || null;

    const standing = getStandingCodeByCode(standingCode);
    if (!standing) {
      return NextResponse.json({ error: 'That code was not found or is no longer active' }, { status: 404 });
    }
    if (files.length === 0 && !note) {
      return NextResponse.json({ error: 'Attach at least one file or a note' }, { status: 400 });
    }
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${f.name} is over the 200MB limit` }, { status: 413 });
      }
    }

    const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
    const quota = checkStorageQuota(incomingBytes);
    if (!quota.ok) {
      return NextResponse.json({ error: quota.error }, { status: 507 });
    }

    const dropId = crypto.randomUUID();
    // Internal code — never shown prominently to the sender, exists only so
    // this row satisfies the same schema every other drop uses. Owner-side
    // downloads go through /api/standing/download, not the public /retrieve
    // flow, so this code being "unused" by the sender is fine.
    const internalCode = generateCode(6);
    const now = Date.now();

    db.prepare(
      `INSERT INTO drops (id, code, vertical, note, max_retrievals, retrieval_count, standing_code_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, 999, 0, ?, ?, ?)`
    ).run(dropId, internalCode, standing.vertical, note, standing.id, now, now + SUBMISSION_EXPIRY_MS);

    for (const f of files) {
      const buffer = Buffer.from(await f.arrayBuffer());
      const fileId = crypto.randomUUID();
      const { storagePath, sha256, sizeBytes } = await saveFile(buffer, dropId, fileId);
      db.prepare(
        `INSERT INTO files (id, drop_id, original_name, mime_type, size_bytes, sha256, storage_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(fileId, dropId, f.name, f.type || 'application/octet-stream', sizeBytes, sha256, storagePath);
    }

    return NextResponse.json({ delivered: true, to: standing.label });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'Something went wrong while delivering your file' }, { status: 500 });
  }
}
