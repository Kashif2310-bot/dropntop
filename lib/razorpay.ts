import crypto from 'crypto';

export const INDIVIDUAL_PLAN = {
  id: 'individual_monthly',
  amountPaise: 4900, // ₹49/month, per MONETIZATION.md
  label: 'drop\'n\'top Pro — ₹49/month',
};

export const SHOP_PLAN = {
  id: 'shop_monthly',
  amountPaise: 14900, // ₹149/month
  label: 'Shop/PG Pro — ₹149/month',
};

export function getPlan(planId: string) {
  return planId === SHOP_PLAN.id ? SHOP_PLAN : INDIVIDUAL_PLAN;
}

/**
 * Verifies a Razorpay Checkout success payload the way Razorpay's own docs
 * specify: HMAC-SHA256 of "{order_id}|{payment_id}" using the account's key
 * secret must equal the signature Checkout.js returned. Pure function, no
 * network call — this is what lets it be unit-tested without live keys.
 */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', params.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');

  // timingSafeEqual requires equal-length buffers, so guard first — a length
  // mismatch is just "not equal", not something to throw on.
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(params.signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
