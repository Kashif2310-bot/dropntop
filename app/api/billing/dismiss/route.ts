import { NextRequest, NextResponse } from 'next/server';

const DISMISS_COOKIE = 'dnt_upsell_dismissed';
const DISMISS_HOURS = 6; // per MONETIZATION.md: dismissible in one tap, don't repeat within a session

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DISMISS_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * DISMISS_HOURS,
  });
  return res;
}
