import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { normalizeCode } from '@/lib/code';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`lookup:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in a minute.' },
      { status: 429 }
    );
  }

  const body = await req.json();
  const code = normalizeCode(body.code || '');

  const drop = db.prepare('SELECT * FROM drops WHERE code = ?').get(code) as any;

  if (!drop) {
    return NextResponse.json({ error: 'No drop found for that code' }, { status: 404 });
  }
  if (drop.expires_at < Date.now()) {
    return NextResponse.json({ error: 'This code has expired' }, { status: 410 });
  }
  if (drop.retrieval_count >= drop.max_retrievals) {
    return NextResponse.json(
      { error: 'This code has reached its access limit set by the sender' },
      { status: 403 }
    );
  }
  if (drop.password_hash) {
    return NextResponse.json({ requiresPassword: true, dropId: drop.id });
  }

  const files = db
    .prepare(
      `SELECT id, original_name, mime_type, size_bytes, has_thumbnail, duration_seconds
       FROM files WHERE drop_id = ?`
    )
    .all(drop.id);

  return NextResponse.json({
    note: drop.note,
    vertical: drop.vertical,
    expiresAt: drop.expires_at,
    remainingRetrievals: drop.max_retrievals - drop.retrieval_count,
    files,
  });
}
