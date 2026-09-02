import crypto from 'crypto';
import db from './db';
import { generateCode } from './code';
import { hashPin } from './pin';

export type StandingCode = {
  id: string;
  code: string;
  label: string;
  vertical: string;
  pin_hash: string;
  created_at: number;
  active: number;
};

export function createStandingCode(label: string, vertical: 'pg' | 'print', pin: string): StandingCode {
  const id = crypto.randomUUID();
  const pinHash = hashPin(pin);
  const createdAt = Date.now();

  // generateCode() only checks uniqueness against the `drops` table, so verify
  // against standing_codes here too and retry on the (extremely rare) clash —
  // the UNIQUE constraint on standing_codes.code is the real backstop.
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode(8); // longer than one-shot codes — this one lives forever
    const clash = db.prepare('SELECT id FROM standing_codes WHERE code = ?').get(code);
    if (clash) continue;

    db.prepare(
      `INSERT INTO standing_codes (id, code, label, vertical, pin_hash, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(id, code, label, vertical, pinHash, createdAt);

    return { id, code, label, vertical, pin_hash: pinHash, created_at: createdAt, active: 1 };
  }
  throw new Error('Could not generate a unique standing code, try again');
}

export function getStandingCodeByCode(code: string): StandingCode | undefined {
  return db.prepare('SELECT * FROM standing_codes WHERE code = ? AND active = 1').get(code) as
    | StandingCode
    | undefined;
}

export function listSubmissions(standingCodeId: string) {
  const drops = db
    .prepare(
      `SELECT id, note, created_at FROM drops WHERE standing_code_id = ? ORDER BY created_at DESC`
    )
    .all(standingCodeId) as { id: string; note: string | null; created_at: number }[];

  const filesStmt = db.prepare(
    'SELECT id, original_name, mime_type, size_bytes FROM files WHERE drop_id = ?'
  );

  return drops.map((d) => ({
    ...d,
    files: filesStmt.all(d.id),
  }));
}
