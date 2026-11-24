# Changelog

## 0.1.0 — 2026-11-24 — Phase 1 core MVP (first slice)

### Added
- Architecture & plan (`docs/ARCHITECTURE.md`), deployment guide (`docs/DEPLOYMENT.md`).
- Postgres schema for all 29 planned tables + `platform_admins`, `phone_verifications`, `support_access_grants`.
- Row Level Security on every table; `anon` has no table access; platform admins need an owner-approved, expiring grant to see customer data.
- `book_appointment()` RPC: per-stylist advisory lock, idempotency keys, hold checks, time-off checks, `EXCLUDE USING gist` overlap constraint as the final guarantee.
- Appointment status history + audit log triggers; `anonymize_customer()` for deletion requests.
- Private `haircut-photos` storage bucket with consent-gated upload policy.
- Pure scheduling engine: salon + staff hours, qualifications, staff-specific durations, cleanup buffers, time off, minimum notice, advance window, closed dates, DST-safe (America/Chicago).
- Shared booking service used by API + dashboard; signed expiring manage links; returning-customer phone OTP (HMAC-hashed, single use, 5 attempts).
- Public booking page (EN/VI): language → service → stylist/first available → date → real times → details → review → confirm → manage link. "Book my usual" after verification; household picker.
- Owner dashboard: Today (status in one tap, counts, est./completed revenue, Book + Walk-in sheet), Calendar (day per-stylist with current-time line, week, month), appointment detail + reschedule, Customers (search, shared-phone flag), customer profile (haircut memory, append-only history timeline, "Same as last time", consent-gated photos in demo), Services, Staff, Analytics + ROI calculator, Settings, AI Receptionist status page.
- Synthetic Tcutz demo data; SMS provider abstraction with test-mode console provider.
- Tests: 37 unit/integration, DB assertion suite + concurrency race, 8 Playwright e2e runs (phone + tablet).

### Fixed during verification
- Idempotent retries returned 409 because availability was checked before the idempotency lookup.
