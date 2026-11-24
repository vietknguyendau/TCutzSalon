# Implementation status

Updated 2026-11-24. Legend: ✅ working and tested · 🟡 partial (see note) · ⛔ not started.
"Tested" means automated tests exist and pass in this repo — not that it has run in Diem's salon.

## Phase 1 — Core MVP

| Area | Status | Notes |
|---|---|---|
| Project setup (Next 16, TS, Tailwind 4, Zod, Vitest, Playwright) | ✅ | shadcn-style components are hand-written (CLI registry unreachable from build env); same API/look. |
| DB schema + migrations | ✅ | Verified on local Postgres 16 with Supabase stubs. **Not yet applied to a real Supabase project.** |
| Tenant isolation (RLS) | ✅ | Cross-tenant read/write, anon, and platform-admin-without-grant tests pass. |
| Double-booking prevention | ✅ | DB exclusion constraint + advisory lock; 8-client race → exactly 1 winner. |
| Idempotency | ✅ | DB + service level. |
| Scheduling engine | ✅ | 17 tests incl. both DST transitions. Processing-time double-booking (cutting while color processes) is **not** modeled — total block = duration + cleanup. |
| Appointment holds | 🟡 | DB function + checks exist; booking page doesn't create holds yet (relies on conflict-at-confirm + friendly "just taken" message). |
| Tcutz branding & service catalog | ✅ | Prices from website. **Durations provisional**; "Sample Stylist" is placeholder. |
| Owner dashboard (Today / Calendar / status changes / walk-in / quick book) | ✅ | Demo mode. |
| Drag-and-drop rescheduling | ⛔ | Reschedule via appointment detail (tap time). |
| Block lunch/vacation from UI; edit hours/services/staff in UI | ⛔ | Schema + engine support them; config via seed for now. |
| Public booking page EN/VI | ✅ | Vietnamese needs native-speaker review. |
| Returning customer OTP + "Book my usual" | ✅ | Demo shows code on screen; real SMS = Phase 2. |
| Manage link (cancel) | ✅ | Reschedule via link = cancel + rebook or call (self-serve reschedule not built). |
| Customer profiles + haircut memory + history timeline | ✅ | |
| Haircut photos | 🟡 | Works in **demo** (in-memory, consent-gated). Supabase Storage upload path not wired (policies exist). |
| Supabase data store | 🟡 | Fully written; RPC/schema verified locally; **needs a run against a real Supabase project** before go-live. |
| Staff login (magic link) | 🟡 | Written; untested without a Supabase project. Staff must be invited (no self-signup). |
| Rate limiting | 🟡 | In-memory; **replace with Upstash/Vercel KV for production** (serverless instances don't share memory). |
| Demo data | ✅ | Synthetic only; 555-01xx numbers. |
| Vercel deployment | ⛔ | Instructions in `docs/DEPLOYMENT.md`; not deployed (needs your accounts). |
| PWA | 🟡 | Manifest + icon; no offline service worker. |

## Phase 2+ (not started)
SMS (Twilio, 10DLC), AI receptionist (Retell/Vapi evaluation → tools → simulator → forwarding), waitlist UI, retention automations, baseline analytics, platform admin dashboard, Stripe. Tables exist for all of these.

## Known decisions needing the owner
See discovery questions in `docs/ARCHITECTURE.md §10` — especially durations, staff, and whether Wix Bookings is active on `/book-online`.
