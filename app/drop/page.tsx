'use client';

import { useState, useRef } from 'react';
import UpgradeCard from '@/app/components/UpgradeCard';

export default function DropPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [maxRetrievals, setMaxRetrievals] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { code: string; expiresAt: number; maxRetrievals: number }>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(list: FileList | null) {
    if (!list) return;
    setFiles(Array.from(list));
  }

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      if (note) fd.append('note', note);
      fd.append('maxRetrievals', String(maxRetrievals));
      fd.append('vertical', 'general');

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
          <p className="success-note">Your drop is ready.</p>
          <div className="code-display">{result.code}</div>
          <p style={{ textAlign: 'center', color: 'var(--muted)' }}>
            Share this code. It works for {result.maxRetrievals} retrieval(s) and expires{' '}
            {new Date(result.expiresAt).toLocaleString()}.
          </p>
          <button onClick={() => { setResult(null); setFiles([]); setNote(''); }} style={{ width: '100%', marginTop: 16 }}>
            Drop another file
          </button>
        </div>
        <UpgradeCard />
      </div>
    );

  }

  return (
    <div>
      <h1>Drop a file</h1>
      <p className="subtitle">Full quality in, full quality out. No account needed.</p>

      <div className="card">
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          {files.length === 0 ? (
            <p>Click or drag files here</p>
          ) : (
            <div>
              {files.map((f) => (
                <div key={f.name} className="file-row">
                  <span>{f.name}</span>
                  <span style={{ color: 'var(--muted)' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              ))}
            </div>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <label htmlFor="note">Add a note instead of / alongside a file (optional)</label>
        <input id="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. semester notes, sec B" />

        <label htmlFor="limit">How many people can use this code?</label>
        <input
          id="limit"
          type="number"
          min={1}
          max={50}
          value={maxRetrievals}
          onChange={(e) => setMaxRetrievals(parseInt(e.target.value || '1', 10))}
        />

        {error && <p className="error">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || (files.length === 0 && !note)}
          style={{ width: '100%', marginTop: 20 }}
        >
          {loading ? 'Uploading…' : 'Generate my code'}
        </button>
      </div>
    </div>
  );
}
