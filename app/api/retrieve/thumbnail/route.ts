import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { normalizeCode } from '@/lib/code';
import { readFile, getPreviewUrl } from '@/lib/storage';
import { checkRateLimit } from '@/lib/rateLimit';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`thumbnail:${ip}`);
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
    .prepare('SELECT * FROM files WHERE id = ? AND drop_id = ? AND has_thumbnail = 1')
    .get(fileId, drop.id) as any;
  if (!file || !file.thumbnail_path) {
    return NextResponse.json({ error: 'No preview available' }, { status: 404 });
  }

  const previewUrl = await getPreviewUrl(file.thumbnail_path);
  if (previewUrl) {
    return NextResponse.redirect(previewUrl, { status: 302 });
  }

  try {
    const buffer = await readFile(file.thumbnail_path);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' },
    });
  } catch {
    return NextResponse.json({ error: 'No preview available' }, { status: 404 });
  }
}
