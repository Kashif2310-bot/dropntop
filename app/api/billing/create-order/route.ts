import { NextRequest, NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getOrCreateDeviceId, hashDeviceGlobal, DEVICE_COOKIE_NAME } from '@/lib/device';
import { getPlan } from '@/lib/razorpay';

// Requires RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in the environment (test
// keys from the Razorpay dashboard while validating the flow, live keys once
// KYC is done). Fails closed with a clear message if they're missing rather
// than throwing an opaque error — this is the one piece of the payment flow
// that genuinely cannot be tested without a real Razorpay account, since it's
// a live API call to Razorpay's servers.
export async function POST(req: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return NextResponse.json(
      { error: 'Payments are not configured yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const plan = getPlan(body.plan);

  const { deviceId, isNew } = getOrCreateDeviceId(req);

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount: plan.amountPaise,
      currency: 'INR',
      receipt: `${plan.id}_${Date.now()}`,
      notes: { deviceHash: hashDeviceGlobal(deviceId), plan: plan.id },
    });

    const res = NextResponse.json({
      orderId: order.id,
      amount: plan.amountPaise,
      currency: 'INR',
      keyId, // public, safe to expose — Checkout.js needs it client-side
      planId: plan.id,
      planLabel: plan.label,
    });
    if (isNew) {
      res.cookies.set(DEVICE_COOKIE_NAME, deviceId, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 });
    }
    return res;
  } catch (err) {
    console.error('Razorpay order creation failed:', err);
    return NextResponse.json({ error: 'Could not start checkout. Try again in a moment.' }, { status: 502 });
  }
}
