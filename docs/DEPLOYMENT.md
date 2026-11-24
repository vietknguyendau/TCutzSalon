# Deployment & go-live guide

## 1. GitHub
```bash
cd chair-salon-platform
git init -b main            # skip if already a repo
git add -A
git commit -m "Phase 1: scheduling engine, schema+RLS, dashboard, bilingual booking"
gh repo create chair-salon-platform --private --source=. --push
```
`.env*` files are git-ignored. Never commit keys; store them in Vercel/Supabase dashboards only.

## 2. Supabase (free tier is fine for testing; upgrade to Pro before real customers — free projects pause after ~1 week of low activity)
1. Create a project (region: `us-east`/`us-central`). Save the DB password in a password manager.
2. Install the CLI and link: `npx supabase login && npx supabase link --project-ref <ref>`
3. Apply schema: `npx supabase db push` (runs `supabase/migrations/*` in order).
4. Seed (pilot/demo tenant only): SQL editor → paste `supabase/seed.sql` → Run. The Tcutz row is `is_demo = true`; flip it to `false` only at go-live with real data.
5. Auth → Providers → Email: enable, **disable sign-ups** (staff are invited). Auth → URL configuration: Site URL = your Vercel URL; add `https://<app>/auth/callback` to redirect URLs.
6. Invite Diem: Auth → Users → Invite. Then link her to the salon:
   ```sql
   insert into salon_memberships (salon_id, user_id, role)
   select '00000000-0000-4000-8001-000000000001', id, 'owner' from auth.users where email = 'diem@…';
   ```
7. Copy Project URL, anon key, service_role key (Settings → API).

## 3. Vercel
1. Import the GitHub repo (framework auto-detected).
2. Environment variables (Production + Preview):
   `DATA_MODE=supabase`, `NEXT_PUBLIC_APP_URL=https://<your-domain>`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (**not** NEXT_PUBLIC), `APP_SIGNING_SECRET` (`openssl rand -base64 48`), `SMS_PROVIDER=console`.
   For a public demo deployment instead, set only `DATA_MODE=demo` and `NEXT_PUBLIC_APP_URL`.
3. Deploy. Hobby plan is for non-commercial use — move to Pro before charging the salon.

## 4. Custom booking domain (`book.tcutz-salon.com`)
1. Vercel → Project → Domains → add `book.tcutz-salon.com`. Vercel shows a CNAME target (typically `cname.vercel-dns.com`).
2. At the DNS host for tcutz-salon.com (Wix if Wix manages DNS: Wix → Domains → Manage DNS Records → CNAME): host `book`, value = the target Vercel shows. Do **not** touch the `@`/`www` records — the Wix site stays as is.
3. Set Vercel env `CUSTOM_DOMAINS=book.tcutz-salon.com=tcutz` and redeploy. `book.tcutz-salon.com/` then serves the booking page.

## 5. Wix integration (only after Diem confirms she wants it — don't change her site without permission)
- **Book Now button (simplest):** Wix Editor → Add → Button → Link → Web address → `https://book.tcutz-salon.com` (or `/book/tcutz` on the Vercel URL), open in same tab. Put it in the header and on the home hero.
- **Embed:** Add → Embed Code → Embed a site → same URL. Height ≥ 900 px. A plain link button usually works better on phones than an iframe.
- **Existing "Book Online" page:** if it's Wix Bookings, replace its menu link with the new URL **on launch day** and turn off Wix Bookings' online booking, so two systems never take overlapping bookings.

## 6. Go-live migration checklist (paper calendar → system)
- [ ] Discovery session done; durations, staff, hours, breaks and policies confirmed and entered.
- [ ] Wix Bookings status confirmed; disable plan agreed.
- [ ] Supabase on Pro; backups on; `is_demo=false`; synthetic customers deleted.
- [ ] Enter **every future appointment** from the paper book (date, time, name, phone, service). Two-person check: one reads, one types, then compare counts per day.
- [ ] Freeze rule: from switch-over day, new bookings go **only** into the system; the paper book is marked "moved to tablet on <date>".
- [ ] Tablet/phone set up at the front desk, app installed to home screen, Diem signed in.
- [ ] Test booking from a customer phone (EN and VI) shows up on the Today screen.
- [ ] Wix "Book" links switched; Wix Bookings off.
- [ ] One week of side-by-side check: end of each day, compare system vs. reality (walk-ins, no-shows).
