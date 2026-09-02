import { NextRequest, NextResponse } from 'next/server';
import { getStandingCodeByCode, listSubmissions } from '@/lib/standingCodes';
import { verifyPin } from '@/lib/pin';
import { normalizeCode } from '@/lib/code';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`standing-dashboard:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  const body = await req.json();
  const code = normalizeCode(body.code || '');
  const pin = (body.pin || '').trim();

  const standing = getStandingCodeByCode(code);
  if (!standing || !verifyPin(pin, standing.pin_hash)) {
    return NextResponse.json({ error: 'Wrong code or PIN' }, { status: 401 });
  }

  const submissions = listSubmissions(standing.id);
  return NextResponse.json({ label: standing.label, vertical: standing.vertical, submissions });
}
