// Client-only. Computes SHA-256 of a File WITHOUT ever holding the whole
// file in memory at once — critical now that files can be up to 2GB and a
// drop can contain 15-20 of them at a time. The old approach
// (`await file.arrayBuffer()` then `crypto.subtle.digest`) allocates a
// buffer the size of the ENTIRE file before hashing a single byte; do that
// for a couple of large videos at once on a mid-range phone and the tab
// simply crashes (silently, from the user's point of view — the drop just
// "doesn't work"). This streams the file in fixed-size chunks instead, so
// memory use stays flat regardless of file size or how many files are being
// hashed in parallel.
import { createSHA256 } from 'hash-wasm';

const CHUNK_BYTES = 8 * 1024 * 1024; // 8MB — small enough to keep memory flat
// across many concurrent large-file hashes, large enough that the overhead
// of slicing/reading each chunk doesn't dominate.

export async function sha256Hex(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_BYTES);
    const buf = await chunk.arrayBuffer();
    hasher.update(new Uint8Array(buf));
    offset += CHUNK_BYTES;
  }

  return hasher.digest('hex');
}
