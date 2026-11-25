# Implementation status

Updated 2026-11-24 (v0.2.0). Legend: ✅ working and tested · 🟡 partial (see note) · ⛔ not started.
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

## Phase 2a — Missed-call text-back

| Area | Status | Notes |
|---|---|---|
| Decision rules (opt-out, landline, dedupe, upcoming appt, quiet hours, language) | ✅ | 25 unit tests incl. DST. |
| Pipeline: call ended → text / hold / call-back | ✅ | Integration tests on demo store, incl. duplicate webhooks and STOP-before-dispatch. |
| Inbound SMS (STOP/START/HELP/CALL/GỌI/free text) | ✅ | Auto-reply max once/hour per number. |
| Twilio webhooks + signature verification | ✅ | Tested with signed requests against the route handlers. |
| Twilio REST send + line lookup | 🟡 | Written to Twilio's API; **not exercised against live Twilio** (no account/network here). |
| Bilingual voice greeting | 🟡 | TwiML generated; Vietnamese voice quality must be checked on a real call. |
| Held-text dispatcher (cron) | 🟡 | Works; Vercel Hobby = daily run (9:05 AM CST), Pro for finer schedule. |
| Call-back list on Today | ✅ | |
| Simulator (demo salon only) | ✅ | |
| Attribution + analytics | ✅ | |
| A2P 10DLC registration, number purchase, carrier forwarding | ⛔ | Needs your Twilio account + Diem's carrier. See `docs/TWILIO_SETUP.md`. |
| Appointment confirmation/reminder texts via Twilio | 🟡 | Confirmation uses the provider layer; 24h/2h reminders not scheduled yet. |

## Phase 2b+ (not started)
AI receptionist (Retell/Vapi evaluation → tools → hand-off from the greeting), reminders, waitlist UI, retention automations, baseline analytics, platform admin dashboard, Stripe. Tables exist for these.

## Known decisions needing the owner
See discovery questions in `docs/ARCHITECTURE.md §10` — especially durations, staff, and whether Wix Bookings is active on `/book-online`.
