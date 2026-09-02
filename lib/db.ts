import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'dropntop.db'));
db.pragma('journal_mode = WAL');
// Required for ON DELETE CASCADE / ON DELETE SET NULL below to actually fire —
// SQLite ignores foreign-key actions entirely unless this is set per connection.
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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
  storage_path TEXT NOT NULL
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
`);

// Idempotent migration for databases created before standing_code_id existed
// (CREATE TABLE IF NOT EXISTS above won't add a column to an existing table).
const dropColumns = db.prepare("PRAGMA table_info(drops)").all() as { name: string }[];
if (!dropColumns.some((c) => c.name === 'standing_code_id')) {
  db.exec('ALTER TABLE drops ADD COLUMN standing_code_id TEXT REFERENCES standing_codes(id) ON DELETE SET NULL');
}

export default db;
