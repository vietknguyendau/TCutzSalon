# Salon Platform — Architecture & Implementation Plan

> "Keep cutting hair. We'll handle the appointments."
> Pilot tenant: **Tcutz Barber & Salon** (owner: Diem) · 9540 Noble Pkwy N, Minneapolis, MN 55443 · 763-315-0044
> Hours per website: Mon–Sat 10:00–19:00, Sun 12:00–17:00 (America/Chicago). Website platform: **Wix** (confirmed via generator tag). The site has a `/book-online` page, which suggests **Wix Bookings may be active** — see §13 and discovery questions.

---

## 1. Product architecture

```
                       ┌──────────────────────────── Vercel (Next.js 16, App Router) ───────────────────────────┐
 Customer (web) ──────▶│  /book/[slug]  public booking (EN/VI)      /app/*  owner & staff dashboard (PWA)       │
 Wix "Book Now" ──────▶│  /book/[slug]/manage/[token]  cancel/resched  /admin/*  platform super-admin            │
 book.tcutz-salon.com ▶│  proxy.ts: host → tenant rewrite                                                        │
                       │                                                                                          │
 Voice agent (Retell/  │  /api/v1/salons/[slug]/…   ◀── ONE scheduling API used by every channel               │
 Vapi) tools ─────────▶│  /api/voice/tools/*  (Phase 2: signed webhooks → same service layer)                  │
 Twilio webhooks ─────▶│  /api/webhooks/*     (Phase 2: signature-verified, idempotent via webhook_events)     │
                       │                                                                                          │
                       │  src/lib/scheduling  (pure availability engine — no I/O, fully unit tested)            │
                       │  src/lib/data        DataStore interface ── DemoStore (in-memory) | SupabaseStore       │
                       │  src/lib/providers   SmsProvider / VoiceProvider interfaces (console | twilio | …)       │
                       └───────────────┬──────────────────────────────────────────────────────────────────────────┘
                                       │ service-role key (server only)  +  user JWT (RLS) for dashboard reads
                       ┌───────────────▼──────────────── Supabase ──────────────────────────────────────────────┐
                       │ Postgres: tenant tables + RLS, book_appointment() RPC (advisory lock + idempotency),    │
                       │ EXCLUDE USING gist constraint = final double-booking guarantee                          │
                       │ Auth: staff/owner via email magic link or phone OTP. Customers: no accounts.           │
                       │ Storage: private `haircut-photos` bucket, path = {salon_id}/{customer_id}/…           │
                       └─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key principles**

1. **Database is the source of truth.** All channels (web, AI phone, manual, walk-in) call the same `createAppointment` service, which calls the `book_appointment()` Postgres function. The frontend's availability view is advisory; the DB constraint is authoritative.
2. **Customers never get DB access.** The public booking page talks only to server routes, which validate with Zod, rate-limit, and use the service role. `anon` has zero table privileges. This is simpler and safer than writing anon RLS policies.
3. **Staff reads go through RLS.** Dashboard queries use the logged-in user's JWT, so a bug in app code still cannot leak another salon's data.
4. **Provider abstraction.** `SmsProvider` and `VoiceProvider` interfaces; `console` (test mode, never sends) is the default. Real providers are selected by env var.
5. **Demo isolation.** Demo mode uses an in-memory store with synthetic data and a persistent "DEMO" banner. In Supabase mode, demo salons carry `salons.is_demo = true`, and the SMS layer refuses to send for them.

## 2. Route map

| Route | Who | Purpose |
|---|---|---|
| `/` | public | Product landing + demo entry |
| `/book/[slug]` | customer | Booking flow: language → service → stylist → date → time → details → review → confirm |
| `/book/[slug]/manage/[token]` | customer | View / cancel via signed expiring link |
| `/login` | staff | Supabase magic link (Supabase mode only) |
| `/app/today` | owner/staff | Today's list, status actions, counts, est. revenue, quick-add, walk-in |
| `/app/calendar` | owner/staff | Day view (per-stylist columns, now-line), week view |
| `/app/customers`, `/app/customers/[id]` | owner/staff | CRM, haircut memory, history timeline, "Same as Last Time" |
| `/app/services`, `/app/staff` | owner/manager | Catalog & team |
| `/app/receptionist` | owner | AI config + simulator (Phase 2) |
| `/app/analytics` | owner | Metrics + ROI calculator |
| `/app/settings` | owner | Hours, policies, notifications |
| `/admin/*` | super admin | Tenants, plans, usage, flags (Phase 4) |
| `GET /api/v1/salons/[slug]/availability` | any channel | `?serviceId&date=YYYY-MM-DD[&staffId]` |
| `POST /api/v1/salons/[slug]/appointments` | any channel | Requires `Idempotency-Key` header |
| `POST /api/v1/salons/[slug]/verify/start` · `/verify/check` | customer | Phone OTP for returning customers |
| `GET/POST /api/v1/manage/[token]` | customer | Appointment lookup / cancel |

## 3. Entity relationships (core)

```
salons 1─1 salon_settings
salons 1─* salon_memberships *─1 auth.users        (role: owner|manager|stylist|receptionist)
platform_admins *─1 auth.users                      (super admin, audited support access)
salons 1─* staff 1─* staff_working_hours
             staff 1─* staff_time_off
             staff *─* services  (staff_services: duration override, enabled)
salons 1─* services 1─* service_addons
salons 1─* customers 1─1 haircut_profiles           (current preferences)
           customers 1─* haircut_history 1─* haircut_photos (consent-gated, storage path)
           customers 1─* customer_consents / communication_preferences / customer_preferences
salons 1─* appointments 1─* appointment_services    (service snapshot: name, price, duration)
           appointments 1─* appointment_status_history
salons 1─* appointment_holds (expiring), waitlist_entries, notifications, callback_requests,
           ai_call_logs, usage_records, phone_verifications
subscription_plans 1─* subscriptions *─1 salons
webhook_events (provider, external_id UNIQUE)  ·  audit_logs (salon_id, actor, action, entity, diff)
```

Households: `customers.phone_e164` is **not unique**. Several profiles may share a phone; after phone verification the customer picks "who is booking," and staff can mark one as `household_primary`.

## 4. Folder structure

```
supabase/
  migrations/          0001_core.sql, 0002_rls.sql, 0003_booking.sql, 0004_storage.sql
  seed.sql             Tcutz salon, services, staff, synthetic customers
  tests/               local Postgres stubs + RLS/overlap tests (npm run test:db)
src/
  app/                 routes (see §2)
  components/ui/       Button, Card, Input, Badge (shadcn-style, hand-written)
  components/app/      dashboard components
  components/booking/  booking flow
  lib/scheduling/      availability engine, time utils (pure)
  lib/data/            DataStore interface, demo store, supabase store, seed fixtures
  lib/providers/       sms/, voice/ abstractions
  lib/i18n/            en.ts, vi.ts
  lib/validation.ts    Zod schemas shared by every API
  lib/tokens.ts        HMAC-signed manage links
  lib/roi.ts           ROI calculator
tests/e2e/             Playwright
```

## 5. Infrastructure cost estimate (pilot, one salon)

Prices checked Nov 2026. Treat them as estimates and re-verify before you commit to anything.

| Item | Pilot monthly | Notes |
|---|---:|---|
| Vercel | $0 → $20 | Hobby is fine for **development and the demo**. Vercel's Hobby terms are for non-commercial use, so move to Pro ($20/user) before charging Diem. |
| Supabase | $0 → $25 | Free: 500 MB DB, 1 GB storage, 2 projects, **pauses after ~1 week of low activity**. Pro ($25) never pauses and adds daily backups. Upgrade before go-live. |
| Twilio phone number | ~$1–2 | Local number for SMS + voice. |
| Twilio SMS | ~$5–15 | ~$0.0083/segment + carrier fees (~$0.003–0.005). **Vietnamese with diacritics uses UCS-2 encoding: 70 chars/segment instead of 160**, so VI messages cost ~2× per message. Templates are kept short. |
| A2P 10DLC | one-time ~$20–50 + ~$2–10/mo | Brand + campaign registration is required, or carriers filter the traffic. Takes days to weeks, so start early in Phase 2. |
| AI voice minutes | ~$40–90 | Assume ~300 calls × 2 min = 600 min at ~$0.07–0.15/min all-in (platform + STT + LLM + TTS + telephony). |
| **Total** | **~$0 during dev; ~$95–200/mo live** | Against an illustrative $149/mo subscription, voice minutes are the swing cost, so we set a usage cap per salon. |

No paid dependency is introduced in Phase 1. Everything runs on free tiers or locally.

## 6. AI voice provider comparison (desk research — must be validated by testing)

| Criterion | Retell AI | Vapi |
|---|---|---|
| Pricing model | Bundled per-minute, ~$0.07–0.31/min by LLM/voice; $10 starter credit; no non-English surcharge | $0.05/min platform + at-cost transcriber/LLM/voice/telephony (realistic ~$0.08–0.15/min) |
| Vietnamese | Marketing page lists Vietnamese among 31+ languages | Depends on chosen STT/TTS (e.g., Deepgram, Azure, ElevenLabs Vietnamese voices) — more knobs, more to test |
| Function calling | Yes (custom functions → our HTTPS tools) | Yes (tools/server URL) |
| Transfer to human | Yes (warm/cold transfer) | Yes (transferCall) |
| Ops complexity | Lower — fewer vendors | Higher — but swap STT/TTS independently, useful if one VI engine is weak |
| Recommendation | **Start pilot tests here** (simpler, fewer bills) | Run the same test script; choose on measured VI accuracy |

**Test protocol (Phase 2, before any live call):** 40 scripted calls (20 EN / 20 VI) recorded with consent by real Vietnamese speakers (Northern + Southern accents, older speakers, salon background noise from a phone speaker). Measure: name/phone/time capture accuracy, wrong-booking rate (must be 0 — enforced by the API confirm step), median response latency (<1.2 s target), mid-call language switching, transfer success. Neither provider is assumed adequate until it passes.

## 7. Security considerations

- **Tenant isolation:** every tenant table has `salon_id`, with RLS policies via the `has_salon_role()` SECURITY DEFINER helper. Tested with `supabase/tests/rls_test.sql`.
- **Service role** is used only in server code (`import "server-only"`). It is never in `NEXT_PUBLIC_*` variables.
- **Public endpoints:** Zod validation, per-IP+phone rate limiting (in-memory in Phase 1; **use Upstash/Vercel KV in production**, because serverless instances don't share memory), generic error messages, no customer data before OTP.
- **OTP:** 6 digits, HMAC-hashed at rest, 10-min expiry, 5 attempts max. Verification returns first names only, so household members can pick who is booking.
- **Manage links:** HMAC-SHA256 signed `{appointmentId, salonId, exp}`, 30-day max, compared in constant time.
- **Photos:** private bucket, signed URLs (short TTL), path-scoped storage RLS, upload blocked unless a `photo` consent row exists.
- **Support access:** platform admins have no implicit RLS access to customer tables. Access requires a time-boxed `support_access_grants` row plus an audit log entry.
- **Webhooks (Phase 2):** verify Twilio/Retell/Vapi signatures, store each in `webhook_events` (unique external id) for idempotency.
- **Audit:** every appointment mutation writes `appointment_status_history` + `audit_logs`.
- **Retention:** customer deletion = hard delete of photos + PII, with appointments kept as anonymized rows for revenue stats (`anonymize_customer()` function).

## 8. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Scheduling engine + schema | Unit tests pass incl. DST; DB rejects overlaps under concurrency |
| M2 | Demo dashboard | Today / Calendar / Customers / haircut memory usable on a tablet |
| M3 | Public booking (EN/VI) | End-to-end booking + manage link in demo mode |
| M4 | Supabase mode | Migrations applied to a real project, staff login, RLS verified |
| M5 | Deploy | Vercel preview + production on a `*.vercel.app` URL |
| M6 | Owner review | Diem approves durations, hours, policies (discovery Qs) |
| Phase 2+ | SMS → voice → growth → SaaS | per roadmap |

## 9. MVP acceptance criteria (Phase 1)

1. The owner can see today's appointments and change status (arrived → in progress → completed / no-show) in ≤2 taps.
2. The owner can add a phone or walk-in appointment in ≤3 taps after choosing a service, with conflicts rejected.
3. Availability respects salon hours, staff hours, time off, existing bookings, cleanup buffers, minimum notice, max advance window, and DST.
4. Two simultaneous bookings for the same slot: exactly one succeeds (DB-level test).
5. Retrying a booking with the same `Idempotency-Key` returns the same appointment.
6. The public booking page works in English and Vietnamese on a phone with no login.
7. Returning-customer data is never shown before OTP verification.
8. Customer profile shows current haircut preferences + full history; "Same as Last Time" pre-fills a booking.
9. User A in salon X cannot read salon Y data (RLS test).
10. Demo mode is visibly labeled and cannot send real SMS.

## 10. Owner discovery questions for Diem

**Scheduling**
1. Who cuts hair besides you? Names, days, hours, and which services each person does.
2. Are the proposed durations right (men's cut 30 min, color 120, etc.)? Do they differ by stylist?
3. Cleanup time between clients? Do you start another client while color processes?
4. Minimum notice for same-day booking? How far ahead can people book?
5. Lunch break: fixed or flexible? Holidays you close?
6. Should color, highlights, and perms need your approval before they're confirmed?
7. How do you handle walk-ins vs. appointments when both arrive at once?

**Phone & customers**
8. Which carrier is the salon number on (for conditional call forwarding)? Is it a landline or a cell?
9. Roughly how many calls per day? How many do you think you miss?
10. What share of callers prefer Vietnamese? Northern or Southern dialect?
11. When should the AI hand the call to you, and to which phone?
12. Cancellation / no-show policy?
13. Are you OK with taking haircut photos, with customer permission?

**Systems**
14. Is the website's "Book Online" page connected to **Wix Bookings**? Does anyone book through it today? (It must be turned off or redirected at launch so two systems don't double-book.)
15. Who manages the Wix site and the domain (DNS) — you or someone else?
16. Do you want the system to text customers? From which number?
17. Would you use a tablet at the front desk, or your phone?
