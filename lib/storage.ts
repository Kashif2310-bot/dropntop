import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// MVP: local disk storage. Swap this file's implementation for Cloudflare R2
// (presigned PUT/GET) when moving to production — nothing else in the app
// needs to change since callers only use saveFile/readFile/deleteFile.

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

export async function saveFile(buffer: Buffer, dropId: string, fileId: string) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const storagePath = path.join(uploadsDir, `${dropId}__${fileId}`);
  fs.writeFileSync(storagePath, buffer);
  return { storagePath, sha256, sizeBytes: buffer.length };
}

export function readFile(storagePath: string): Buffer {
  return fs.readFileSync(storagePath);
}

export function deleteFile(storagePath: string) {
  if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
}
