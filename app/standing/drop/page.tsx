'use client';

import { useState, useRef } from 'react';

export default function StandingDropPage() {
  const [standingCode, setStandingCode] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [delivered, setDelivered] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('standingCode', standingCode);
      files.forEach((f) => fd.append('files', f));
      if (note) fd.append('note', note);

      const res = await fetch('/api/standing/drop', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setDelivered(data.to);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (delivered) {
    return (
      <div className="card">
        <p className="success-note">Delivered to {delivered}.</p>
        <p style={{ color: 'var(--muted)' }}>They'll see it as soon as they check their dashboard. No code for you to remember — you're done.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Drop into a standing code</h1>
      <p className="subtitle">For submitting to a PG, hostel, or print shop that's given you a code.</p>

      <div className="card">
        <label htmlFor="standingCode">Their code</label>
        <input
          id="standingCode"
          type="text"
          inputMode="numeric"
          value={standingCode}
          onChange={(e) => setStandingCode(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="e.g. 48291374"
        />

        <div
          className="dropzone"
          style={{ marginTop: 16 }}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files) setFiles(Array.from(e.dataTransfer.files)); }}
        >
          {files.length === 0 ? (
            <p>Click or drag files here</p>
          ) : (
            files.map((f) => (
              <div key={f.name} className="file-row">
                <span>{f.name}</span>
                <span style={{ color: 'var(--muted)' }}>{(f.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            ))
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => e.target.files && setFiles(Array.from(e.target.files))}
          />
        </div>

        <label htmlFor="note">Note (optional — e.g. your name/room number)</label>
        <input id="note" type="text" value={note} onChange={(e) => setNote(e.target.value)} />

        {error && <p className="error">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || !standingCode || (files.length === 0 && !note)}
          style={{ width: '100%', marginTop: 20 }}
        >
          {loading ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
