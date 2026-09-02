'use client';

import { useState } from 'react';

type FileMeta = { id: string; original_name: string; mime_type: string; size_bytes: number };
type Submission = { id: string; note: string | null; created_at: number; files: FileMeta[] };

export default function StandingDashboardPage() {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<{ label: string; submissions: Submission[] } | null>(null);

  async function handleLogin() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/standing/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pin }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Something went wrong');
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (data) {
    return (
      <div>
        <h1>{data.label}</h1>
        <p className="subtitle">{data.submissions.length} submission(s)</p>
        {data.submissions.map((s) => (
          <div key={s.id} className="card" style={{ marginBottom: 16 }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{new Date(s.created_at).toLocaleString()}</p>
            {s.note && <p><strong>Note:</strong> {s.note}</p>}
            {s.files.map((f) => (
              <div key={f.id} className="file-row">
                <span>{f.original_name} <span style={{ color: 'var(--muted)' }}>({(f.size_bytes / 1024 / 1024).toFixed(2)} MB)</span></span>
                <a href={`/api/standing/download?code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}&fileId=${f.id}`}>
                  <button className="secondary">Download</button>
                </a>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="subtitle">Enter your standing code and PIN to see what's been dropped.</p>

      <div className="card">
        <label htmlFor="code">Code</label>
        <input id="code" type="text" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} />
        <label htmlFor="pin">PIN</label>
        <input id="pin" type="text" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))} />
        {error && <p className="error">{error}</p>}
        <button onClick={handleLogin} disabled={loading || !code || !pin} style={{ width: '100%', marginTop: 20 }}>
          {loading ? 'Checking…' : 'View submissions'}
        </button>
      </div>
    </div>
  );
}
