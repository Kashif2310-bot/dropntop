import crypto from 'crypto';
import { NextRequest } from 'next/server';

const COOKIE_NAME = 'dnt_device';

/** Returns (and issues, if missing) a stable-per-browser random id, used only
 * to let the SAME device re-download a file it already retrieved without
 * burning another slot on the dropper's accessor limit. Not linked to identity. */
export function getOrCreateDeviceId(req: NextRequest): { deviceId: string; isNew: boolean } {
  const existing = req.cookies.get(COOKIE_NAME)?.value;
  if (existing) return { deviceId: existing, isNew: false };
  const deviceId = crypto.randomBytes(16).toString('hex');
  return { deviceId, isNew: true };
}

export function hashDevice(deviceId: string, dropId: string): string {
  return crypto.createHash('sha256').update(`${deviceId}:${dropId}`).digest('hex');
}

/** App-wide (not per-drop) hash of a device id, for usage tracking in
 * lib/usage.ts — deliberately not the same value as hashDevice() above,
 * so a leaked usage count can't be correlated back to specific retrievals. */
export function hashDeviceGlobal(deviceId: string): string {
  return crypto.createHash('sha256').update(`global:${deviceId}`).digest('hex');
}

export const DEVICE_COOKIE_NAME = COOKIE_NAME;
