'use client';

import { useState } from 'react';

export default function ClipboardPage() {
  const [text, setText] = useState('');
  const [maxRetrievals, setMaxRetrievals] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { code: string; expiresAt: number; maxRetrievals: number }>(null);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('note', text);
      fd.append('maxRetrievals', String(maxRetrievals));
      fd.append('vertical', 'clipboard');

      const res = await fetch('/api/drop', { method: 'POST', body: fd });
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
      <div>
        <div className="card">
          <p className="success-note">Your clipboard is ready.</p>
          <div className="code-display">{result.code}</div>
          <p style={{ textAlign: 'center', color: 'var(--muted)' }}>
            Share this code. It works for {result.maxRetrievals} retrieval(s) and expires{' '}
            {new Date(result.expiresAt).toLocaleString()}.
          </p>
          <button
            onClick={() => {
              setResult(null);
              setText('');
            }}
            style={{ width: '100%', marginTop: 16 }}
          >
            Send another message
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1>Online clipboard</h1>
      <p className="subtitle">
        Paste text on one device, get a code, type the code anywhere else and it's there — no app, no login,
        no messaging yourself on WhatsApp.
      </p>

      <div className="card">
        <label htmlFor="text">Your text</label>
        <textarea
          id="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type anything — a link, a password, an address, a whole paragraph…"
          rows={10}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px solid var(--line)',
            borderRadius: 8,
            font: 'inherit',
            resize: 'vertical',
          }}
        />

        <label htmlFor="limit" style={{ marginTop: 16, display: 'block' }}>
          How many people can use this code?
        </label>
        <input
          id="limit"
          type="number"
          min={1}
          max={50}
          value={maxRetrievals}
          onChange={(e) => setMaxRetrievals(parseInt(e.target.value || '1', 10))}
        />

        {error && <p className="error">{error}</p>}

        <button onClick={handleSubmit} disabled={loading || !text.trim()} style={{ width: '100%', marginTop: 20 }}>
          {loading ? 'Sending…' : 'Get my code'}
        </button>
      </div>
    </div>
  );
}
