import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dropntop.db'));
// This MUST be the very first pragma run on the connection. Next.js's build
// step ("collecting page data") imports every API route in several parallel
// workers, so several processes open this same database file at once and
// race to run pragmas/CREATE TABLE statements against it. The default busy
// timeout is 0 — an immediate SQLITE_BUSY failure on the very first pragma
// call if another worker holds the lock — so busy_timeout has to be set
// before any other pragma (journal_mode, foreign_keys) gets a chance to be
// the one that loses that race. Once this is set, better-sqlite3 waits up
// to 5s for the lock instead of failing instantly (matters in production
// too, under real concurrent requests, not just at build time).
db.pragma('busy_timeout = 5000');
db.pragma('journal_mode = WAL');
// Required for ON DELETE CASCADE / ON DELETE SET NULL below to actually fire —
// SQLite ignores foreign-key actions entirely unless this is set per connection.
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  vertical TEXT NOT NULL DEFAULT 'general',   -- 'general' | 'exam' | 'pg' | 'print'
  note TEXT,
  max_retrievals INTEGER NOT NULL DEFAULT 5,
  retrieval_count INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  standing_code_id TEXT REFERENCES standing_codes(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  -- 1 for every existing/legacy upload path (server-buffered — the row is
  -- only ever inserted after the bytes are already safely in storage). Direct
  -- browser->R2 uploads (see /api/drop/presign) insert the row BEFORE the
  -- browser has actually uploaded anything, with confirmed=0, then flip it to
  -- 1 in /api/drop/finalize once R2 confirms the object really exists. A row
  -- that never gets confirmed (tab closed mid-upload) is what
  -- lib/cleanup.ts's abandoned-upload sweep purges.
  confirmed INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS retrievals (
  id TEXT PRIMARY KEY,
  drop_id TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  retrieved_at INTEGER NOT NULL,
  device_hash TEXT
);

-- A standing code belongs to a PG owner, print shop, cyber café, etc. Unlike a
-- one-shot drop code, it stays alive indefinitely and accepts many separate
-- submissions over time. Access to the submissions list is gated by pin_hash,
-- not by a retrieval-limit/expiry pair like ordinary drops.
CREATE TABLE IF NOT EXISTS standing_codes (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  vertical TEXT NOT NULL,                      -- 'pg' | 'print'
  pin_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Lightweight per-device usage counters, read by the (not-yet-built) paywall
-- logic described in MONETIZATION.md. Kept separate from the retrievals table
-- because that table is scoped to one drop; this one tracks a device's
-- activity across the whole app over a rolling window.
CREATE TABLE IF NOT EXISTS device_usage (
  device_hash TEXT PRIMARY KEY,
  drop_count INTEGER NOT NULL DEFAULT 0,
  retrieve_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Tied to device_hash rather than a real account, because there is no login
-- system yet. This is a known, documented limitation (see CLAUDE.md) — a
-- cleared cookie loses Pro status. Fine for validating that payment actually
-- works end to end; replace with email/phone-linked accounts before this is
-- how real customers keep paid access across devices.
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL,
  plan TEXT NOT NULL,                          -- 'individual_monthly' | 'shop_monthly'
  status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'expired' | 'cancelled'
  razorpay_order_id TEXT NOT NULL,
  razorpay_payment_id TEXT,
  amount_paise INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_device ON subscriptions(device_hash);

CREATE TABLE IF NOT EXISTS pending_orders (
  razorpay_order_id TEXT PRIMARY KEY,
  device_hash TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// Idempotent migrations for databases created before these columns existed
// (CREATE TABLE IF NOT EXISTS above won't add a column to an existing table).
// The check-then-ALTER is only atomic within one process — Next.js's build
// step ("collecting page data") imports this module from several parallel
// workers against the same on-disk file, so more than one worker can see the
// column missing and race to add it. The loser doesn't hit SQLITE_BUSY (this
// isn't a lock-wait situation); it hits a logical "duplicate column name"
// error instead, which busy_timeout does nothing for. Swallowing that one
// specific error makes the migration safe to run concurrently.
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  try {
    db.exec(ddl);
  } catch (err) {
    if (err instanceof Error && /duplicate column name/i.test(err.message)) return;
    throw err;
  }
}

addColumnIfMissing(
  'drops',
  'standing_code_id',
  'ALTER TABLE drops ADD COLUMN standing_code_id TEXT REFERENCES standing_codes(id) ON DELETE SET NULL'
);

// Same idempotent pattern for the confirmed flag on files (see the comment
// on that column above) — existing databases predate direct-to-R2 uploads.
addColumnIfMissing('files', 'confirmed', 'ALTER TABLE files ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 1');

export default db;
