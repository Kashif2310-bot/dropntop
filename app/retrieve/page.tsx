'use client';

import { useState } from 'react';
import UpgradeCard from '@/app/components/UpgradeCard';

type FileMeta = { id: string; original_name: string; mime_type: string; size_bytes: number };
type LookupResult = {
  note: string | null;
  expiresAt: number;
  remainingRetrievals: number;
  files: FileMeta[];
};

export default function RetrievePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  async function handleLookup() {
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/retrieve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
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

  return (
    <div>
      <h1>Retrieve a file</h1>
      <p className="subtitle">Enter the code you were given.</p>

      <div className="card">
        <label htmlFor="code">Code</label>
        <input
          id="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="482913"
          onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
        />
        {error && <p className="error">{error}</p>}
        <button onClick={handleLookup} disabled={loading || !code} style={{ width: '100%', marginTop: 16 }}>
          {loading ? 'Looking up…' : 'Find my drop'}
        </button>

        {result && (
          <div style={{ marginTop: 24 }}>
            {result.note && (
              <p><strong>Note:</strong> {result.note}</p>
            )}
            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              {result.remainingRetrievals} retrieval(s) left · expires {new Date(result.expiresAt).toLocaleString()}
            </p>
            {result.files.map((f) => (
              <div key={f.id} className="file-row">
                <span>{f.original_name} <span style={{ color: 'var(--muted)' }}>({(f.size_bytes / 1024 / 1024).toFixed(2)} MB)</span></span>
                <a
                  href={`/api/retrieve/file?code=${encodeURIComponent(code)}&fileId=${f.id}`}
                  onClick={() => setDownloaded(true)}
                >
                  <button className="secondary">Download</button>
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shown right after a download starts — the "relieved, happy" moment
          MONETIZATION.md calls out as the right time to ask, not before. */}
      {downloaded && <UpgradeCard />}
    </div>
  );
}
