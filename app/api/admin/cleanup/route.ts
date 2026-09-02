import { NextRequest, NextResponse } from 'next/server';
import { purgeExpired } from '@/lib/cleanup';

// Wire this to a real cron trigger before launch (Vercel Cron, a systemd timer,
// or GitHub Actions on a schedule) — hitting this endpoint is what actually
// reclaims storage from expired drops. Protected by a shared secret since
// there's no admin auth system yet; set ADMIN_CLEANUP_SECRET in your .env.
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret');
  const expected = process.env.ADMIN_CLEANUP_SECRET;

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await purgeExpired();
  return NextResponse.json(result);
}
