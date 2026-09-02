import db from './db';

export function recordPendingOrder(params: {
  orderId: string;
  deviceHash: string;
  plan: string;
  amountPaise: number;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO pending_orders (razorpay_order_id, device_hash, plan, amount_paise, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(params.orderId, params.deviceHash, params.plan, params.amountPaise, Date.now());
}

export function getPendingOrder(
  orderId: string
): { deviceHash: string; plan: string; amountPaise: number } | null {
  const row = db
    .prepare(
      `SELECT device_hash as deviceHash, plan, amount_paise as amountPaise
       FROM pending_orders WHERE razorpay_order_id = ?`
    )
    .get(orderId) as { deviceHash: string; plan: string; amountPaise: number } | undefined;
  return row ?? null;
}
