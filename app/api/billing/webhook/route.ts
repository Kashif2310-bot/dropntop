import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getPendingOrder } from '@/lib/orders';
import { activateSubscription } from '@/lib/subscriptions';

// Server-to-server backstop for /api/billing/verify. Razorpay calls this
// directly from their own servers the instant a payment is captured,
// independent of whether the customer's browser is still around — so a
// closed tab or dropped connection right after paying can no longer mean
// "paid but never got Pro." activateSubscription() is idempotent per order
// (see lib/subscriptions.ts#isOrderActivated), so it's safe for both this
// webhook and the client-side verify call to race to activate the same
// order — whichever arrives first wins, the other is a no-op.
export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('RAZORPAY_WEBHOOK_SECRET is not set — refusing webhook call');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-razorpay-signature') || '';

  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(signature, 'hex');
  const valid =
    expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf);

  if (!valid) {
    console.error('Razorpay webhook signature mismatch — rejecting');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  if (event.event === 'payment.captured') {
    const payment = event.payload?.payment?.entity;
    const orderId = payment?.order_id;
    const paymentId = payment?.id;

    if (orderId && paymentId) {
      const pending = getPendingOrder(orderId);
      if (pending) {
        activateSubscription({
          deviceHash: pending.deviceHash,
          plan: pending.plan,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          amountPaise: pending.amountPaise,
        });
      } else {
        console.error(`Webhook payment.captured for unknown order ${orderId}`);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
