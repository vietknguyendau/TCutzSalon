-- 0005 Missed-call text-back (Phase 2, feature 1).
-- Calls the salon can't answer are forwarded to the salon's provider number; when the call ends without a
-- booking, the caller gets one text with the booking link (subject to opt-out, landline, dedupe, quiet hours).

alter table salons add column provider_number_e164 text unique;

alter table salon_settings
  add column missed_call_settings jsonb not null default '{"enabled": true, "dedupe_hours": 12, "upcoming_window_days": 14}'::jsonb,
  add column public_booking_url text;

-- Opt-outs are keyed by PHONE, not customer: callers may not have a profile, and STOP must always win.
create table sms_opt_outs (
  salon_id uuid not null references salons(id) on delete cascade,
  phone_e164 text not null,
  opted_out boolean not null,
  source text not null check (source in ('sms_keyword', 'staff', 'web')),
  updated_at timestamptz not null default now(),
  primary key (salon_id, phone_e164)
);
alter table sms_opt_outs enable row level security;
alter table sms_opt_outs force row level security;
revoke all on sms_opt_outs from anon;
create policy sms_opt_outs_member_select on sms_opt_outs for select to authenticated
  using (public.has_salon_role(salon_id));
grant select on sms_opt_outs to authenticated;

-- Call log covers ordinary forwarded calls too, not only AI calls.
alter table ai_call_logs drop constraint ai_call_logs_outcome_check;
alter table ai_call_logs add constraint ai_call_logs_outcome_check check (outcome in
  ('missed', 'voicemail', 'abandoned', 'info', 'booked', 'rescheduled', 'canceled', 'transferred', 'callback', 'failed'));
create index ai_call_logs_salon_started_idx on ai_call_logs (salon_id, started_at desc);

-- `reason` existed as free text in 0001; constrain it to the known kinds.
update callback_requests set reason = 'customer_asked'
 where reason is null or reason not in ('landline_missed_call', 'customer_asked', 'sms_reply', 'ai_escalation');
alter table callback_requests
  alter column reason set default 'customer_asked',
  alter column reason set not null,
  add constraint callback_requests_reason_check
    check (reason in ('landline_missed_call', 'customer_asked', 'sms_reply', 'ai_escalation')),
  add column message text check (length(message) <= 1000);
create index callback_requests_open_idx on callback_requests (salon_id, created_at desc) where status = 'open';

-- Attribution so analytics can count "booked after a missed-call text".
alter table appointments add column attribution text check (attribution ~ '^[a-z_]{1,32}$');

-- Fast "did we already text this number recently?" lookups.
create index notifications_dedupe_idx on notifications (salon_id, to_address, template, scheduled_for desc);
