// Pure data, no server-only imports — safe to import from client components.
// Kept separate from lib/examCompress.ts, which imports `sharp` (a native,
// server-only module that would break the client bundle if pulled in here).
export type ExamPreset = {
  id: string;
  label: string;
  minKB: number;
  maxKB: number;
};

// Common Indian exam-portal upload specs. Approximate/representative — exact
// numbers vary by exam cycle, so treat this as a starting list to correct
// against real portal instructions, not a source of truth.
export const EXAM_PRESETS: ExamPreset[] = [
  { id: 'photo-small', label: 'Photo — small (e.g. 20-50KB)', minKB: 20, maxKB: 50 },
  { id: 'photo-large', label: 'Photo — larger (e.g. 50-200KB)', minKB: 50, maxKB: 200 },
  { id: 'signature', label: 'Signature (e.g. 4-30KB)', minKB: 4, maxKB: 30 },
  { id: 'custom', label: 'Custom target size', minKB: 1, maxKB: 5000 },
];
