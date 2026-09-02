'use client';

import { useState, useRef } from 'react';
import { EXAM_PRESETS } from '@/lib/examPresets';

export default function ExamPage() {
  const [file, setFile] = useState<File | null>(null);
  const [presetId, setPresetId] = useState('photo-small');
  const [customKB, setCustomKB] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { code: string; finalKB: number; targetKB: number; hitFloor: boolean }>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const preset = EXAM_PRESETS.find((p) => p.id === presetId)!;
  const targetKB = presetId === 'custom' ? customKB : preset.maxKB;

  async function handleSubmit() {
    if (!file) return;
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('targetKB', String(targetKB));
      const res = await fetch('/api/exam/compress', { method: 'POST', body: fd });
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
        <p className="success-note">
          Compressed to {result.finalKB}KB (target was {result.targetKB}KB)
          {result.hitFloor && ' — this is as small as we could get it without visibly degrading it further'}.
        </p>
        <div className="code-display">{result.code}</div>
        <p style={{ textAlign: 'center', color: 'var(--muted)' }}>
          Use this code on the <a href="/retrieve">retrieve page</a> — from a cyber café, a friend's
          laptop, anywhere — to download the compressed file, ready to upload to the portal.
        </p>
        <button onClick={() => { setResult(null); setFile(null); }} style={{ width: '100%', marginTop: 16 }}>
          Compress another
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Exam form photo/signature sizer</h1>
      <p className="subtitle">Compress to the exact KB a portal demands, then grab it anywhere with a code.</p>

      <div className="card">
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
        >
          {file ? (
            <div className="file-row">
              <span>{file.name}</span>
              <span style={{ color: 'var(--muted)' }}>{(file.size / 1024).toFixed(0)} KB</span>
            </div>
          ) : (
            <p>Click or drag an image here</p>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
          />
        </div>

        <label htmlFor="preset">Target size</label>
        <select
          id="preset"
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--line)' }}
        >
          {EXAM_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        {presetId === 'custom' && (
          <>
            <label htmlFor="customKB">Exact target (KB)</label>
            <input id="customKB" type="number" min={1} max={5000} value={customKB} onChange={(e) => setCustomKB(parseInt(e.target.value || '1', 10))} />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <button onClick={handleSubmit} disabled={loading || !file} style={{ width: '100%', marginTop: 20 }}>
          {loading ? 'Compressing…' : 'Compress and get a code'}
        </button>
      </div>
    </div>
  );
}
