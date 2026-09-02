import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

export function isDirectUploadSupported(): boolean {
  return useR2;
}

export async function getUploadUrl(key: string, expiresInSeconds = 900): Promise<string | null> {
  if (!useR2 || !s3) return null;
  const command = new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

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

/**
 * Returns a presigned URL the BROWSER can GET directly from R2, bypassing
 * this server for the actual bytes — the download-side mirror of
 * getUploadUrl() above. Without this, /api/retrieve/file would have to read
 * the whole file into this server's memory before it could send a single
 * byte back — fine for a few MB, but a 2GB video would try to allocate 2GB
 * of RAM on a container with a fraction of that. With this, the browser
 * downloads straight from Cloudflare's network and Railway never sees the
 * bytes. `filename` sets Content-Disposition so the browser saves it under
 * the original name. Returns null when R2 isn't configured — callers fall
 * back to the buffered readFile() path (fine for local dev, small files).
 */
export async function getDownloadUrl(
  key: string,
  filename: string,
  expiresInSeconds = 300
): Promise<string | null> {
  if (!useR2 || !s3) return null;
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Presigned GET for displaying an object inline (no Content-Disposition
 * override, so the browser renders it — an <img> tag, not a download
 * prompt). Used for gallery thumbnails.
 */
export async function getPreviewUrl(key: string, expiresInSeconds = 300): Promise<string | null> {
  if (!useR2 || !s3) return null;
  const command = new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function deleteFile(storagePath: string) {
  if (useR2 && s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: storagePath }));
    return;
  }
  if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
}
