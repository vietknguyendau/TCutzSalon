# Chair — salon appointments platform

> **Keep cutting hair. We'll handle the appointments.**
> Pilot tenant: Tcutz Barber & Salon (Minneapolis). "Chair" is a working product name — change it in `src/app/layout.tsx`, `src/app/manifest.ts` and `src/app/page.tsx`.

Multi-tenant salon scheduling: a digital appointment book for the owner, haircut memory for every regular, and English/Vietnamese online booking with no app or account. Built so a bilingual AI phone receptionist (Phase 2) books through the **same** API and database.

## Quick start (demo mode — no credentials)

```bash
npm install
npm run dev            # http://localhost:3000
```

- `/app/today` — owner dashboard (Tcutz demo, synthetic customers)
- `/app/receptionist` ("Phone & texts") — missed-call text-back simulator: pick a caller, see the text they'd get, reply STOP/CALL.
- `/book/tcutz` — customer booking page (EN/VI). On "Book my usual", use phone `(763) 555-0101` (shared household: Minh + Bao) or `555-0103`. The demo shows the verification code on screen.

Demo mode keeps data **in memory**: it resets on restart and at local midnight. It is clearly bannered and never sends texts.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Vitest: scheduling engine (incl. DST), booking service, tokens, ROI, validation |
| `npm run test:db` | Applies all migrations + seed to a throwaway **local Postgres ≥15**, runs RLS/overlap/idempotency assertions and an 8-client concurrency race |
| `npm run test:e2e` | Playwright on phone + tablet viewports (needs `npm run build` first; set `CHROME_PATH` or run `npx playwright install chromium`) |
| `npm run check` | typecheck + lint + unit tests |
| `npm run seed:generate` | Regenerates `supabase/seed.sql` from `src/lib/data/fixtures.ts` |

## Layout

```
docs/ARCHITECTURE.md      architecture, route map, ERD, costs, AI vendor comparison, security, discovery questions
docs/DEPLOYMENT.md        Supabase, Vercel, GitHub, Wix, DNS, go-live migration checklist
docs/TWILIO_SETUP.md      missed-call text-back: 10DLC, number config, call forwarding, test plan
supabase/migrations/      schema, RLS, booking RPC, storage policies
supabase/tests/           local-Postgres stubs + DB assertions
src/lib/scheduling/       pure availability engine (no I/O)
src/lib/booking/service.ts  the ONE booking service every channel uses
src/lib/data/             DataStore interface → DemoStore | SupabaseStore
src/app/api/v1/           public booking API (availability, appointments, verify, manage)
src/app/app/              owner dashboard
src/app/book/[slug]/      public booking + manage-link pages
```

See `IMPLEMENTATION_STATUS.md` for what is real, what is partial, and what is next.
