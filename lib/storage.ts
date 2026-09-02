import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Dual-mode storage: uses Cloudflare R2 (S3-compatible, zero egress fees,
// redundant object storage — not a single disk that can get corrupted or
// wiped on a restart) when R2_* env vars are set, and falls back to local
// disk automatically when they're not, so local dev and a Railway deploy
// without R2 configured keep working exactly as before. Every other file in
// the app only ever calls saveFile/readFile/deleteFile — this is the only
// file that needs to know which backend is actually in use.

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

const useR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

const s3 = useR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID!, secretAccessKey: R2_SECRET_ACCESS_KEY! },
    })
  : null;

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!useR2 && !fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export async function saveFile(buffer: Buffer, dropId: string, fileId: string) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const key = `${dropId}__${fileId}`;

  if (useR2 && s3) {
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: buffer }));
    return { storagePath: key, sha256, sizeBytes: buffer.length };
  }

  const storagePath = path.join(uploadsDir, key);
  fs.writeFileSync(storagePath, buffer);
  return { storagePath, sha256, sizeBytes: buffer.length };
}

export async function readFile(storagePath: string): Promise<Buffer> {
  if (useR2 && s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: storagePath }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  return fs.readFileSync(storagePath);
}

/**
 * Returns a presigned URL the BROWSER can PUT a file to directly, bypassing
 * this server entirely for the actual bytes — this is what fixes the
 * upload-is-slow problem: without this, every file crosses the network
 * twice (browser -> Railway -> R2), and Railway buffers the whole file in
 * memory before forwarding it. With this, the file goes browser -> R2 in
 * one hop, straight to Cloudflare's network (which peers very well in
 * India), and Railway only ever handles small JSON requests.
 *
 * Returns null when R2 isn't configured (local-disk fallback) — callers
 * should fall back to the old buffered upload path in that case, since a
 * plain local dev server has nothing for the browser to PUT directly to.
 */
export function isDirectUploadSupported(): boolean {
  return useR2;
}

export async function getUploadUrl(key: string, expiresInSeconds = 900): Promise<string | null> {
  if (!useR2 || !s3) return null;
  const command = new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/** Confirms an object actually landed in R2 after a direct browser upload,
 * and returns its real size — used by /api/drop/finalize instead of trusting
 * whatever size the client claimed before the upload happened. */
export async function headFile(key: string): Promise<{ exists: boolean; sizeBytes?: number }> {
  if (!useR2 || !s3) return { exists: fs.existsSync(path.join(uploadsDir, key)) };
  try {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return { exists: true, sizeBytes: res.ContentLength };
  } catch {
    return { exists: false };
  }
}

export async function deleteFile(storagePath: string) {
  if (useR2 && s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: storagePath }));
    return;
  }
  if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
}
