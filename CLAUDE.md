# drop'n'top — project spec for Claude Code

Read this first before making changes. It captures decisions already made so you
don't re-litigate them, and the roadmap so you know what's next.

## What this is
An India-first website: drop a file, get a short numeric code, anyone with the
code retrieves it at full, unmodified quality on `/retrieve`. No accounts, no
WhatsApp, no compression. Three go-to-market wedges share one core engine:

1. **Exam-form bundle** (`/exam`) — auto-compress a photo to the exact KB spec
   an Indian exam portal demands (CUET, SSC, UPSC, Railway, bank exams), then
   hand back a retrieve code in the same flow.
2. **PG/hostel document drop** (`/standing/*`) — a persistent code per PG or
   landlord so a new tenant submits ID proof and photos without exchanging
   phone numbers.
3. **Print shop vertical** (`/standing/*`, vertical='print') — a shop's
   standing code so customers send print jobs ahead at full quality instead
   of over the owner's personal WhatsApp.

All three sit on the same drop/retrieve engine. Wedges 2 and 3 share the exact
same standing-code implementation — the only difference is the `vertical`
field and copy on the create page. Do not fork the codebase per vertical.

## Current state (built across two sessions, verified working)
Not yet deployed; verified locally with a full build + live smoke test of
every flow (drop, retrieve, standing codes, exam compression, cleanup) before
each handoff — see "What's been tested" below before assuming something is
broken.

- Next.js 14 App Router, TypeScript.
- SQLite via `better-sqlite3`, with `PRAGMA foreign_keys = ON` (required for
  cascade deletes to actually fire — SQLite ignores FK actions without it;
  this was a real bug caught and fixed during testing). **Swap for Postgres
  (Neon/Supabase) before scaling past one server instance.**
- Local disk storage in `/uploads` via `lib/storage.ts`. **Swap for Cloudflare
  R2** before production — `saveFile`/`readFile`/`deleteFile` are the only
  surface other code touches.
- In-memory rate limiting in `lib/rateLimit.ts` (5 attempts/min per IP on
  lookup, download, and standing-code endpoints). **Swap for Upstash Redis**
  before running more than one server instance.
- **Codes are plain digits, no hyphen** — 6 digits for one-shot drops, 8
  digits for standing codes (see `lib/code.ts` for the entropy trade-off this
  implies and why rate limiting matters more as a result). Retrieve/standing
  code inputs use `inputMode="numeric"` so mobile shows a number pad.
- Core drop/retrieve: multi-file + note, accessor-limit enforcement, 24h
  default expiry, SHA-256 integrity check on both upload and download
  (`X-Checksum-Match` header — not yet surfaced as a visible badge in the UI),
  same-device re-download without burning a retrieval slot (cookie-based).
- **Standing codes** (`lib/standingCodes.ts`, `app/api/standing/*`,
  `app/standing/*`): an owner creates a code + PIN at `/standing/create`;
  anyone drops files into it at `/standing/drop` (sender gets a "delivered to
  X" confirmation, not a code); the owner views/downloads submissions at
  `/standing/dashboard` after entering code+PIN. Cross-tenant isolation is
  enforced at the query level (a valid PIN for shop A cannot reach shop B's
  files even if a file id is guessed) — verified in testing.
- **Exam-form compression** (`lib/examCompress.ts` — server-only, imports
  `sharp`; presets live in `lib/examPresets.ts` — pure data, safe for client
  components — keep this split, a client page importing `examCompress.ts`
  directly breaks the build by trying to bundle `sharp` for the browser).
  Binary-searches JPEG quality to hit a target KB, falls back to downscaling
  if quality=1 still doesn't fit. Images only — PDFs are NOT handled yet.
- **Usage tracking foundation** (`lib/usage.ts`, `device_usage` table):
  records a drop/retrieve count per device on every drop and every successful
  retrieval. No UI reads this yet — it exists so the paywall work in
  MONETIZATION.md has data to trigger on from day one instead of needing a
  new tracking system bolted on later.
- **Cleanup job** (`lib/cleanup.ts`, `POST /api/admin/cleanup`): purges
  expired drops' files from disk and deletes the DB rows (cascades to
  `files`/`retrievals` via FK). Gated by an `ADMIN_CLEANUP_SECRET` env var
  (`x-admin-secret` header) — the endpoint fails closed (401) if that env var
  isn't set, which is deliberate. **Not wired to a schedule yet** — call it
  from a cron (Vercel Cron, a systemd timer, GitHub Actions) before storage
  costs matter.
- Pages: home, `/drop`, `/retrieve`, `/security`, `/exam`, `/standing/create`,
  `/standing/drop`, `/standing/dashboard`. Deliberately unpolished by request
  — functionality first, visual design deferred.

### What's been tested (don't re-verify from scratch, extend instead)
Live smoke-tested against a running server in this session: numeric code
format end to end; drop→retrieve round-trip with byte-identical checksum
match; standing-code create→drop→dashboard round-trip; wrong-PIN rejection;
cross-tenant file isolation; exam compression hitting an exact KB target on a
real 1.2MB test photo (compressed to 27KB against a 30KB target); FK cascade
delete verified to leave zero orphaned rows; cleanup endpoint's fail-closed
behavior without a secret. TypeScript compiles clean, production build
succeeds, and `sharp` does not leak into the client bundle (confirmed via
build output route sizes).

- **Paywall + payments (Razorpay)**: `lib/paywall.ts` decides, from
  `device_usage`, whether a device should see the upgrade prompt (fires at 4+
  combined drops/retrievals, never on first use — `UPGRADE_PROMPT_THRESHOLD`
  is the one constant to tune). `app/api/billing/status` is polled by
  `app/components/UpgradeCard.tsx`, which is dropped into the `/drop` and
  `/retrieve` success states and decides for itself whether to render —
  nothing else needs to know about billing. Dismissing sets a 6-hour cookie
  (`app/api/billing/dismiss`). Paying goes through Razorpay's standard
  Checkout.js order flow: `app/api/billing/create-order` creates a Razorpay
  order server-side (needs `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`, fails
  closed with a clear error if unset — do not remove that check), the client
  opens Razorpay's hosted checkout, and `app/api/billing/verify` checks the
  HMAC-SHA256 signature Razorpay returns before calling
  `activateSubscription()` in `lib/subscriptions.ts`. **Subscriptions are
  keyed to `device_hash`, not a real account** — a cleared cookie loses Pro
  status. This is fine for validating the payment flow itself but should not
  be how paying customers keep access once there's real revenue; replace with
  email/phone-linked accounts before that matters.

### What's been tested (billing, this session)
Live-tested against a running server: order creation correctly fails closed
(500) with no `RAZORPAY_KEY_ID`/`SECRET` set; with fake test keys, order
creation correctly fails (502, graceful) when it actually hits Razorpay's API
(expected — the keys aren't real); the paywall trigger was driven through 4
real drops on one cookie session and confirmed to flip `showUpgradePrompt`
from `false` to `true` exactly on the 4th, while a second, separate device
session stayed at `false` at the same count (proving per-device isolation);
dismiss correctly suppresses the prompt afterward; the signature-verification
function was tested standalone (valid signature accepted, tampered signature
rejected, wrong secret rejected, wrong order id rejected — all as HMAC math
predicts) and then end-to-end through `/api/billing/verify` with a
correctly-signed fake payment, which activated a subscription and flipped
`isPro` to `true` immediately, versus a tampered signature which was rejected
with no subscription created. **Order creation against Razorpay's real API
was not tested** — that needs a real Razorpay account (test mode, no KYC
required) with real test keys in `.env.local`; everything downstream of
receiving a valid order back has been verified.

### Not yet built
- Password-protected drops (schema has `password_hash`, no UI/logic yet).
- PDF compression for the exam-form vertical (images only right now).
- A visible "checksum verified ✓" badge in the retrieve/dashboard UI (the
  header exists, nothing reads it client-side yet).
- A Razorpay webhook listener (`payment.captured`) as a backstop for the case
  where the browser closes after paying but before the client-side verify
  call fires — the current flow handles the normal case correctly but has
  this one gap; Razorpay's docs cover the webhook payload shape.
- Deployment config (Vercel or a VPS) and the R2/Postgres/Redis swaps.
- Automated tests (everything so far has been manually smoke-tested per
  session, not covered by a test suite).
- QR code generation for standing codes (currently just the digit code —
  useful for a print-shop counter card or PG entrance poster).
- Shop/PG-side billing UI (the `shop_monthly` plan exists in `lib/razorpay.ts`
  but nothing on `/standing/create` or `/standing/dashboard` offers it yet).

## Data model (see `lib/db.ts`)
- `drops`: id, code, vertical, note, max_retrievals, retrieval_count,
  password_hash, standing_code_id (nullable — set when this drop is a
  submission into a standing code), created_at, expires_at.
- `files`: id, drop_id, original_name, mime_type, size_bytes, sha256,
  storage_path.
- `retrievals`: id, drop_id, retrieved_at, device_hash — one row per
  device-that-actually-downloaded a given drop.
- `standing_codes`: id, code, label, vertical ('pg'|'print'), pin_hash,
  created_at, active.
- `device_usage`: device_hash, drop_count, retrieve_count, first_seen_at,
  last_seen_at — read by `lib/paywall.ts` to decide when to show the upgrade
  prompt.
- `subscriptions`: id, device_hash, plan, status, razorpay_order_id,
  razorpay_payment_id, amount_paise, started_at, expires_at — one row per
  successful payment; `lib/subscriptions.ts#isPro()` checks for an active,
  unexpired row.

## Monetization — read MONETIZATION.md before building any paywall UI
Short version: free tier must be genuinely usable and habit-forming. Never
show a price on someone's first drop or retrieve. Upgrade prompts fire either
right after a successful retrieval on someone's 4th-5th use in a month, or
exactly at a friction point (file too big, limit reached) — framed as
preventing the next frustration, never as holding the current file hostage.
Individual users pay tiny amounts (₹49/mo, or a ₹19-29 one-time "exam season
pack"); shop/PG owners pay a small monthly B2B fee once their free-tier
volume shows real usage. `lib/usage.ts` already tracks the numbers this logic
needs — building the trigger is now a UI + threshold-check task, not a new
data-collection task.

## Immediate next tasks, roughly in order
1. **Get a real Razorpay account and test keys** — this is the one thing only
   Kashif can do (sign up at razorpay.com, test mode needs no KYC), and
   nothing past order-creation can be verified further without it.
2. Surface the `X-Checksum-Match` header as a visible "verified ✓" badge on
   the retrieve and standing-dashboard pages.
3. Add the `shop_monthly` plan to `/standing/create` or `/standing/dashboard`
   so PG/print-shop owners can actually upgrade too (currently only the
   individual ₹49/mo plan is wired into any UI).
4. Add a Razorpay webhook listener as a backstop for the verify-call-never-
   fires gap noted above.
5. PDF support for the exam-form vertical (pdf-lib or ghostscript,
   re-rasterizing pages to hit a target size the way images already do).
6. QR code generation for standing codes (a `qrcode` npm package rendering
   the code as a scannable image on the `/standing/create` result screen).
7. Swap SQLite → Postgres, local disk → R2, in-memory rate limit → Redis.
8. Wire `/api/admin/cleanup` to an actual schedule.
9. Password-protected drops (finish the UI for the existing `password_hash`
   column).
10. Real accounts (email/phone OTP) to replace device-hash-tied
    subscriptions before charging real customers at any scale.

## Running locally
```
npm install
cp .env.example .env.local   # fill in Razorpay test keys to test payments
npm run dev
```
Visit http://localhost:3000. Data lives in `data/dropntop.db`, files in
`uploads/` — both gitignored. Without Razorpay keys set, everything except
actually completing a payment works normally — the upgrade prompt still
appears, it just can't open checkout (fails with a clear message, not a
crash). Without `ADMIN_CLEANUP_SECRET` set, the cleanup endpoint correctly
refuses all requests — that's the safe default, not a bug.
