import crypto from 'crypto';

// Simple scrypt-based PIN hashing for standing-code dashboards. This gates a
// shop/PG owner's view of their own submissions, not a payment or identity
// system — fine for MVP. Swap for a real auth flow (magic link / OTP) once
// standing codes are something people pay for.
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(8).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const check = crypto.scryptSync(pin, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(check, 'hex'));
}
