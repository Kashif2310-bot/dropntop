import crypto from 'crypto';
import db from './db';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isPro(deviceHash: string): boolean {
  const row = db
    .prepare(
      `SELECT id FROM subscriptions WHERE device_hash = ? AND status = 'active' AND expires_at > ? LIMIT 1`
    )
    .get(deviceHash, Date.now());
  return !!row;
}

export function isOrderActivated(razorpayOrderId: string): boolean {
  const row = db
    .prepare(`SELECT id FROM subscriptions WHERE razorpay_order_id = ? LIMIT 1`)
    .get(razorpayOrderId);
  return !!row;
}

export function activateSubscription(params: {
  deviceHash: string;
  plan: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  amountPaise: number;
}): void {
  if (isOrderActivated(params.razorpayOrderId)) return;

  const now = Date.now();
  db.prepare(
    `INSERT INTO subscriptions (id, device_hash, plan, status, razorpay_order_id, razorpay_payment_id, amount_paise, started_at, expires_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.deviceHash,
    params.plan,
    params.razorpayOrderId,
    params.razorpayPaymentId,
    params.amountPaise,
    now,
    now + THIRTY_DAYS_MS
  );
}
