import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { getPaywallStatus } from '@/lib/paywall';

const DISMISS_COOKIE = 'dnt_upsell_dismissed';

// Polled by the client right after a successful drop/retrieve — deliberately
// not baked into those responses directly, so the same status check can be
// reused anywhere (standing dashboard, exam page) without touching those
// routes' response shape.
export async function GET(req: NextRequest) {
  const { deviceId, isNew } = getOrCreateDeviceId(req);
  const dismissed = !!req.cookies.get(DISMISS_COOKIE)?.value;
  const status = getPaywallStatus(hashDeviceGlobal(deviceId), dismissed);

  const res = NextResponse.json(status);
  if (isNew) {
    res.cookies.set(DEVICE_COOKIE_NAME, deviceId, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}
