import { NextRequest, NextResponse } from 'next/server';
import { createStandingCode } from '@/lib/standingCodes';
import { checkRateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rl = checkRateLimit(`standing-create:${ip}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  }

  const body = await req.json();
  const label = (body.label || '').trim();
  const vertical = body.vertical === 'print' ? 'print' : 'pg';
  const pin = (body.pin || '').trim();

  if (label.length < 2 || label.length > 80) {
    return NextResponse.json({ error: 'Give it a name between 2 and 80 characters' }, { status: 400 });
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4-8 digits' }, { status: 400 });
  }

  const standing = createStandingCode(label, vertical, pin);
  return NextResponse.json({ code: standing.code, label: standing.label, vertical: standing.vertical });
}
