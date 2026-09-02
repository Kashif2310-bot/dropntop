'use client';

import { useState } from 'react';
import UpgradeCard from '@/app/components/UpgradeCard';

type FileMeta = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  has_thumbnail: number;
  duration_seconds: number | null;
};
type LookupResult = {
  note: string | null;
  expiresAt: number;
  remainingRetrievals: number;
  files: FileMeta[];
};

function formatDuration(seconds: number | null): string {
  if (!seconds || !isFinite(seconds)) return '';
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isPreviewable(f: FileMeta) {
  return f.mime_type.startsWith('image/') || f.mime_type.startsWith('video/');
}

export default function RetrievePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  async function handleCopyNote() {
    if (!result?.note) return;
    try {
      await navigator.clipboard.writeText(result.note);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be denied/unavailable — the text is still visible
      // and selectable on the page either way, so this is a soft failure.
    }
  }

  const galleryFiles = result?.files.filter(isPreviewable) ?? [];
  const otherFiles = result?.files.filter((f) => !isPreviewable(f)) ?? [];

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
              <div
                style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 20,
                }}
              >
                <p style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{result.note}</p>
                <button className="secondary" onClick={handleCopyNote}>
                  {copied ? 'Copied ✓' : 'Copy text'}
                </button>
              </div>
            )}

            <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
              {result.remainingRetrievals} retrieval(s) left · expires {new Date(result.expiresAt).toLocaleString()}
            </p>

            {galleryFiles.length > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                  gap: 10,
                  marginTop: 8,
                }}
              >
                {galleryFiles.map((f) => (
                  <a
                    key={f.id}
                    href={`/api/retrieve/file?code=${encodeURIComponent(code)}&fileId=${f.id}`}
                    onClick={() => setDownloaded(true)}
                    style={{
                      position: 'relative',
                      display: 'block',
                      aspectRatio: '1 / 1',
                      borderRadius: 8,
                      overflow: 'hidden',
                      background: '#e8e5de',
                      border: '1px solid var(--line)',
                    }}
                    title={`${f.original_name} (${(f.size_bytes / 1024 / 1024).toFixed(2)} MB) — click to download`}
                  >
                    {f.has_thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/retrieve/thumbnail?code=${encodeURIComponent(code)}&fileId=${f.id}`}
                        alt={f.original_name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--muted)',
                          fontSize: '0.75rem',
                          padding: 6,
                          textAlign: 'center',
                        }}
                      >
                        {f.mime_type.startsWith('video/') ? '🎬' : '🖼️'} preview unavailable
                      </div>
                    )}
                    {f.mime_type.startsWith('video/') && (
                      <>
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.15)',
                          }}
                        >
                          <div
                            style={{
                              width: 0,
                              height: 0,
                              borderTop: '8px solid transparent',
                              borderBottom: '8px solid transparent',
                              borderLeft: '13px solid rgba(255,255,255,0.92)',
                              marginLeft: 3,
                            }}
                          />
                        </div>
                        {f.duration_seconds != null && (
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              right: 5,
                              background: 'rgba(0,0,0,0.65)',
                              color: '#fff',
                              fontSize: '0.68rem',
                              padding: '1px 5px',
                              borderRadius: 4,
                            }}
                          >
                            {formatDuration(f.duration_seconds)}
                          </span>
                        )}
                      </>
                    )}
                  </a>
                ))}
              </div>
            )}

            {otherFiles.length > 0 && (
              <div style={{ marginTop: galleryFiles.length > 0 ? 20 : 8 }}>
                {otherFiles.map((f) => (
                  <div key={f.id} className="file-row">
                    <span>
                      {f.original_name}{' '}
                      <span style={{ color: 'var(--muted)' }}>({(f.size_bytes / 1024 / 1024).toFixed(2)} MB)</span>
                    </span>
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
        )}
      </div>

      {downloaded && <UpgradeCard />}
    </div>
  );
}
