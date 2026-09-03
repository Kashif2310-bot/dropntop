'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import UpgradeCard from '@/app/components/UpgradeCard';
import { generateImageThumbnail, generateVideoThumbnail } from '@/lib/thumbnail';
import { sha256Hex } from '@/lib/hash';
import { runWithConcurrency } from '@/lib/concurrency';

const MAX_FILES = 20; // matches the presign endpoint's expectations — see
// app/api/drop/presign/route.ts. A hard cap, not a soft warning, because
// past this the point-of-the-feature (a browsable gallery, not a wall of
// tiles) starts breaking down anyway.
const UPLOAD_CONCURRENCY = 3; // how many files are hashed+uploaded at once —
// see lib/concurrency.ts for why this isn't unbounded Promise.all.
const PUT_RETRIES = 2;

type FileStatus = 'queued' | 'hashing' | 'uploading' | 'done' | 'failed';

type PendingFile = {
  file: File;
  previewUrl: string | null; // instant local object URL — see effect below
  isVideo: boolean;
  status: FileStatus;
};

function isPreviewableType(type: string) {
  return type.startsWith('image/') || type.startsWith('video/');
}

async function putWithRetry(url: string, body: Blob | File, retries: number): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body });
      if (res.ok) return res;
      lastErr = new Error(`Upload failed with status ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    // Small backoff before retrying — helps on flaky mobile connections
    // where the previous attempt failed mid-transfer.
    if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error('Upload failed');
}

export default function DropPage() {
  const [items, setItems] = useState<PendingFile[]>([]);
  const [note, setNote] = useState('');
  const [maxRetrievals, setMaxRetrievals] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<null | { code: string; expiresAt: number; maxRetrievals: number }>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke every object URL we created so the browser can free the memory —
  // otherwise picking 20 files, removing them, and picking 20 more leaks.
  useEffect(() => {
    return () => {
      items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const room = MAX_FILES - items.length;
    if (room <= 0) {
      setError(`You can drop up to ${MAX_FILES} files at a time.`);
      return;
    }
    const toAdd = incoming.slice(0, room);
    if (incoming.length > toAdd.length) {
      setError(`Only added the first ${toAdd.length} — ${MAX_FILES} files is the limit per drop.`);
    } else {
      setError('');
    }

    // Instant local preview — this is the point: you should be able to SEE
    // what you just picked immediately, not after it finishes uploading.
    // A plain object URL costs nothing (no decode/canvas work) and every
    // browser can render it straight into <img>/<video>.
    const newItems: PendingFile[] = toAdd.map((file) => {
      const previewable = isPreviewableType(file.type);
      return {
        file,
        previewUrl: previewable ? URL.createObjectURL(file) : null,
        isVideo: file.type.startsWith('video/'),
        status: 'queued',
      };
    });
    setItems((prev) => [...prev, ...newItems]);
  }

  function removeItem(index: number) {
    setItems((prev) => {
      const target = prev[index];
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  const setStatus = useCallback((index: number, status: FileStatus) => {
    setItems((prev) => {
      const next = prev.slice();
      if (next[index]) next[index] = { ...next[index], status };
      return next;
    });
  }, []);

  async function handleSubmitLegacy() {
    const fd = new FormData();
    items.forEach((it) => fd.append('files', it.file));
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
      const files = items.map((it) => it.file);
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

      // Bounded-concurrency pipeline: hash + upload (+ best-effort thumbnail)
      // for a handful of files at a time instead of firing all 15-20 at once.
      // See lib/concurrency.ts — this is the actual fix for "large batches
      // don't work," not any single file being too big.
      const finalizeFiles = await runWithConcurrency(
        presignData.uploads,
        UPLOAD_CONCURRENCY,
        async (u: { fileId: string; uploadUrl: string; thumbnailUploadUrl?: string | null }, i: number) => {
          const file = files[i];
          try {
            setStatus(i, 'hashing');
            const [sha256, putRes] = await Promise.all([
              sha256Hex(file),
              (async () => {
                setStatus(i, 'uploading');
                return putWithRetry(u.uploadUrl, file, PUT_RETRIES);
              })(),
            ]);
            if (!putRes.ok) throw new Error(`Upload failed for ${file.name}`);

            let thumbnailUploaded = false;
            let durationSeconds: number | undefined;

            // Best-effort: a thumbnail that fails to generate or upload
            // never fails the drop itself, it just means that tile shows a
            // generic icon instead of a preview on the retrieve page.
            if (u.thumbnailUploadUrl) {
              try {
                if (file.type.startsWith('video/')) {
                  const { blob, durationSeconds: dur } = await generateVideoThumbnail(file);
                  if (blob) {
                    const thumbRes = await putWithRetry(u.thumbnailUploadUrl, blob, 1);
                    thumbnailUploaded = thumbRes.ok;
                  }
                  durationSeconds = dur ?? undefined;
                } else if (file.type.startsWith('image/')) {
                  const blob = await generateImageThumbnail(file);
                  if (blob) {
                    const thumbRes = await putWithRetry(u.thumbnailUploadUrl, blob, 1);
                    thumbnailUploaded = thumbRes.ok;
                  }
                }
              } catch {
                // ignore — thumbnail is best-effort
              }
            }

            setStatus(i, 'done');
            return { fileId: u.fileId, sha256, thumbnailUploaded, durationSeconds };
          } catch (e) {
            setStatus(i, 'failed');
            throw e;
          }
        }
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
      setError(e.message || 'Something went wrong — please try again.');
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
          <button
            onClick={() => {
              items.forEach((it) => it.previewUrl && URL.revokeObjectURL(it.previewUrl));
              setResult(null);
              setItems([]);
              setNote('');
            }}
            style={{ width: '100%', marginTop: 16 }}
          >
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
      <p className="subtitle">
        Full quality in, full quality out. No account needed. Up to {MAX_FILES} files, 2GB each.
      </p>

      <div className="card">
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
        >
          {items.length === 0 ? (
            <p>Click or drag files here</p>
          ) : (
            <p style={{ margin: 0, color: 'var(--muted)' }}>
              {items.length} file(s) selected — click to add more
            </p>
          )}
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              handleFiles(e.target.files);
              // Allow re-selecting the same file(s) later after removal.
              e.target.value = '';
            }}
          />
        </div>

        {/* Preview grid — this is the whole point: you see what you're
            about to send BEFORE it uploads, so a batch of 20 photos never
            turns into an unlabeled pile the way WhatsApp documents do. */}
        {items.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: 10,
              marginTop: 16,
            }}
          >
            {items.map((it, i) => (
              <div
                key={i}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: '#e8e5de',
                  border: '1px solid var(--line)',
                }}
                title={`${it.file.name} (${(it.file.size / 1024 / 1024).toFixed(2)} MB)`}
              >
                {it.previewUrl ? (
                  it.isVideo ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      src={it.previewUrl}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.previewUrl}
                      alt={it.file.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  )
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      color: 'var(--muted)',
                      textAlign: 'center',
                      padding: 4,
                    }}
                  >
                    {it.file.name}
                  </div>
                )}

                {!loading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(i);
                    }}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      padding: 0,
                      borderRadius: '50%',
                      background: 'rgba(0,0,0,0.6)',
                      fontSize: '0.8rem',
                      lineHeight: 1,
                    }}
                    aria-label={`Remove ${it.file.name}`}
                  >
                    ×
                  </button>
                )}

                {loading && it.status !== 'queued' && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      right: 4,
                      background: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      fontSize: '0.65rem',
                      padding: '2px 5px',
                      borderRadius: 4,
                      textAlign: 'center',
                    }}
                  >
                    {it.status === 'hashing' && 'Checking…'}
                    {it.status === 'uploading' && 'Uploading…'}
                    {it.status === 'done' && 'Done ✓'}
                    {it.status === 'failed' && 'Failed'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <label htmlFor="note" style={{ marginTop: 20 }}>
          Add a note instead of / alongside a file (optional)
        </label>
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
          disabled={loading || (items.length === 0 && !note)}
          style={{ width: '100%', marginTop: 20 }}
        >
          {loading ? `Uploading ${items.filter((i) => i.status === 'done').length}/${items.length}…` : 'Generate my code'}
        </button>
      </div>
    </div>
  );
}
