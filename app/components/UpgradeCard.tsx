'use client';

import { useEffect, useState } from 'react';
import { loadRazorpayCheckout } from '@/lib/loadRazorpayCheckout';

type Props = {
  /** Which plan this card sells — 'individual_monthly' (₹49) or 'shop_monthly' (₹149).
   * Defaults to the individual plan, used on /drop and /retrieve. */
  plan?: string;
};

/**
 * Self-contained: checks /api/billing/status on mount and renders nothing if
 * the visitor shouldn't see an upgrade prompt (first-time user, already Pro,
 * dismissed recently, or hasn't crossed the usage threshold yet). Drop this
 * into any page's success state — it decides for itself whether to show up.
 * See MONETIZATION.md for why the trigger logic lives server-side, not here.
 */
export default function UpgradeCard({ plan = 'individual_monthly' }: Props) {
  const [visible, setVisible] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/billing/status')
      .then((r) => r.json())
      .then((data) => setVisible(!!data.showUpgradePrompt))
      .catch(() => {}); // fail silent — never block the page over an upsell check
  }, []);

  async function handleDismiss() {
    setVisible(false);
    fetch('/api/billing/dismiss', { method: 'POST' }).catch(() => {});
  }

  async function handleUpgrade() {
    setError('');
    setPaying(true);
    try {
      await loadRazorpayCheckout();

      const orderRes = await fetch('/api/billing/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.error || 'Could not start checkout');

      const razorpay = new (window as any).Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "drop'n'top",
        description: order.planLabel,
        order_id: order.orderId,
        theme: { color: '#e2622b' },
        handler: async (response: any) => {
          const verifyRes = await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...response, plan }),
          });
          const result = await verifyRes.json();
          if (verifyRes.ok) {
            setSuccess(true);
          } else {
            setError(result.error || 'Payment could not be verified');
          }
          setPaying(false);
        },
        modal: {
          ondismiss: () => setPaying(false),
        },
      });
      razorpay.open();
    } catch (e: any) {
      setError(e.message);
      setPaying(false);
    }
  }

  if (success) {
    return (
      <div className="card" style={{ marginTop: 24, borderColor: 'var(--accent-2)' }}>
        <p className="success-note">You're on Pro now — thanks for backing this. 🎉</p>
      </div>
    );
  }

  if (!visible) return null;

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <button
        onClick={handleDismiss}
        style={{ float: 'right', background: 'none', color: 'var(--muted)', padding: 4, fontSize: '0.8rem' }}
      >
        ✕
      </button>
      <p style={{ marginTop: 0, fontWeight: 600 }}>You've used drop'n'top a few times now.</p>
      <p style={{ color: 'var(--muted)' }}>
        Go Pro for ₹49/month — less than one printout run — and skip the limits for good.
      </p>
      {error && <p className="error">{error}</p>}
      <button onClick={handleUpgrade} disabled={paying} className="secondary">
        {paying ? 'Opening checkout…' : 'Go Pro — ₹49/month'}
      </button>
    </div>
  );
}
