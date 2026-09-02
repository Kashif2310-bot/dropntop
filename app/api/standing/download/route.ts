import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import db from '@/lib/db';
import { getStandingCodeByCode } from '@/lib/standingCodes';
import { verifyPin } from '@/lib/pin';
import { normalizeCode } from '@/lib/code';
import { readFile } from '@/lib/storage';
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`standing-download:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const code = normalizeCode(searchParams.get('code') || '');
  const pin = (searchParams.get('pin') || '').trim();
  const fileId = searchParams.get('fileId') || '';

  const standing = getStandingCodeByCode(code);
  if (!standing || !verifyPin(pin, standing.pin_hash)) {
    return NextResponse.json({ error: 'Wrong code or PIN' }, { status: 401 });
  }

  // Only serve files whose drop actually belongs to this standing code —
  // otherwise a valid PIN for one shop could be used to guess file ids
  // belonging to a different shop.
  const file = db
    .prepare(
      `SELECT files.* FROM files
       JOIN drops ON drops.id = files.drop_id
       WHERE files.id = ? AND drops.standing_code_id = ?`
    )
    .get(fileId, standing.id) as any;

  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const buffer = await readFile(file.storage_path);
  const verifySha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': file.mime_type,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.original_name)}"`,
      'Content-Length': String(file.size_bytes),
      'X-Checksum-SHA256': verifySha256,
      'X-Checksum-Match': String(verifySha256 === file.sha256),
    },
  });
}
