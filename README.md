# drop'n'top

Drop a file, get a code. Anyone with the code retrieves it at full quality —
no WhatsApp, no email, no compression, no account.

See `CLAUDE.md` for the full project spec, current state, and roadmap before
making changes. See `MONETIZATION.md` for the pricing/paywall design.

## Quick start
```
npm install
npm run dev
```
Open http://localhost:3000.

## Stack (MVP)
Next.js 14 (App Router, TypeScript) · SQLite (`better-sqlite3`) · local disk
storage. See CLAUDE.md for what to swap in before real deployment (Postgres,
Cloudflare R2, Redis, Razorpay).
