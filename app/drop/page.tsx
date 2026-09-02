'use client';

import { useState, useRef } from 'react';
import UpgradeCard from '@/app/components/UpgradeCard';
import { generateImageThumbnail, generateVideoThumbnail } from '@/lib/thumbnail';

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

  async function sha256Hex(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function handleSubmitLegacy() {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (note) fd.append('note', note);
    fd.append('maxRetrievals', String(maxRetrievals));
    fd.append('vertical', 'general');

    const res = await fetch('/api/drop', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    setResult(data);
  }

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const presignRes = await fetch('/api/drop/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
          note: note || undefined,
          maxRetrievals: String(maxRetrievals),
          vertical: 'general',
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || 'Something went wrong');

      if (!presignData.direct) {
        await handleSubmitLegacy();
        return;
      }

      // Upload every file straight to R2, in parallel, hashing each one as
      // we go. Image/video files also get a small preview thumbnail
      // generated right here in the browser and uploaded alongside the
      // original — see lib/thumbnail.ts.
      const finalizeFiles = await Promise.all(
        presignData.uploads.map(
          async (u: { fileId: string; uploadUrl: string; thumbnailUploadUrl?: string | null }, i: number) => {
            const file = files[i];
            const [sha256, putRes] = await Promise.all([
              sha256Hex(file),
              fetch(u.uploadUrl, { method: 'PUT', body: file }),
            ]);
            if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);

            let thumbnailUploaded = false;
            let durationSeconds: number | undefined;

            if (u.thumbnailUploadUrl) {
              try {
                if (file.type.startsWith('video/')) {
                  const { blob, durationSeconds: dur } = await generateVideoThumbnail(file);
                  if (blob) {
                    const thumbRes = await fetch(u.thumbnailUploadUrl, { method: 'PUT', body: blob });
                    thumbnailUploaded = thumbRes.ok;
                  }
                  durationSeconds = dur ?? undefined;
                } else if (file.type.startsWith('image/')) {
                  const blob = await generateImageThumbnail(file);
                  if (blob) {
                    const thumbRes = await fetch(u.thumbnailUploadUrl, { method: 'PUT', body: blob });
                    thumbnailUploaded = thumbRes.ok;
                  }
                }
              } catch {
                // ignore — thumbnail is best-effort
              }
            }

            return { fileId: u.fileId, sha256, thumbnailUploaded, durationSeconds };
          }
        )
      );

      const finalizeRes = await fetch('/api/drop/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropId: presignData.dropId, files: finalizeFiles }),
      });
      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) throw new Error(finalizeData.error || 'Something went wrong finishing your drop');

      setResult({
        code: presignData.code,
        expiresAt: presignData.expiresAt,
        maxRetrievals: presignData.maxRetrievals,
      });
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
