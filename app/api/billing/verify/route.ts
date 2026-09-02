import { NextRequest, NextResponse } from 'next/server';
import { verifyPaymentSignature, getPlan } from '@/lib/razorpay';
import { activateSubscription } from '@/lib/subscriptions';
import { getOrCreateDeviceId, hashDeviceGlobal } from '@/lib/device';

// Called by the client after Razorpay's Checkout.js reports success. This is
// the standard Razorpay order-flow verification (HMAC of order_id|payment_id
// with the account's key secret) — it's what stops someone from faking a
// "success" callback client-side and getting Pro for free. A production
// deployment should ALSO listen for Razorpay's server-to-server webhook
// (payment.captured) as a backstop for the case where the browser closes
// before this call fires — not implemented yet, noted in CLAUDE.md.
export async function POST(req: NextRequest) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return NextResponse.json({ error: 'Payments are not configured yet.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: 'Missing payment details' }, { status: 400 });
  }

  const valid = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
    keySecret,
  });

  if (!valid) {
    return NextResponse.json({ error: 'Payment could not be verified' }, { status: 400 });
  }

  const { deviceId } = getOrCreateDeviceId(req);
  const planDetails = getPlan(plan);

  activateSubscription({
    deviceHash: hashDeviceGlobal(deviceId),
    plan: planDetails.id,
    razorpayOrderId: razorpay_order_id,
    razorpayPaymentId: razorpay_payment_id,
    amountPaise: planDetails.amountPaise,
  });

  return NextResponse.json({ success: true });
}
