'use client';

import { useState } from 'react';

export default function CreateStandingCodePage() {
  const [label, setLabel] = useState('');
  const [vertical, setVertical] = useState<'pg' | 'print'>('pg');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ code: string; label: string } | null>(null);

  async function handleCreate() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/standing/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, vertical, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="card">
        <p className="success-note">Your standing code is ready — {result.label}</p>
        <div className="code-display">{result.code}</div>
        <p style={{ color: 'var(--muted)' }}>
          Put this code up where people will see it — a printed card at the entrance, a QR sign at
          the counter. Anyone can drop files to it at <code>/standing/drop</code>. Only you, with
          your PIN, can see what's been dropped, at <code>/standing/dashboard</code>. This code
          never expires.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Set up a standing code</h1>
      <p className="subtitle">For a PG, hostel, or print shop — one code, used again and again.</p>

      <div className="card">
        <label htmlFor="label">Name (shown to whoever drops a file)</label>
        <input id="label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sharma PG, Block A" />

        <label htmlFor="vertical">What is this for?</label>
        <select
          id="vertical"
          value={vertical}
          onChange={(e) => setVertical(e.target.value as 'pg' | 'print')}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--line)' }}
        >
          <option value="pg">PG / hostel — collecting tenant documents</option>
          <option value="print">Print shop — collecting print jobs</option>
        </select>

        <label htmlFor="pin">Set a 4-8 digit PIN (you'll use this to view submissions)</label>
        <input id="pin" type="text" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1234" />

        {error && <p className="error">{error}</p>}

        <button onClick={handleCreate} disabled={loading || !label || !pin} style={{ width: '100%', marginTop: 20 }}>
          {loading ? 'Creating…' : 'Create my standing code'}
        </button>
      </div>
    </div>
  );
}
