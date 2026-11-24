-- 0001 core schema: tenants, staff, services, customers, haircut memory, appointments.
-- All timestamps are timestamptz (stored UTC). Local wall-clock values (business hours) are
-- stored as `time` + the salon's IANA timezone and converted in the scheduling engine.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------- enums ----------
create type membership_role as enum ('owner', 'manager', 'stylist', 'receptionist');
create type appointment_status as enum
  ('pending_approval', 'booked', 'confirmed', 'arrived', 'in_progress', 'completed', 'canceled', 'no_show');
create type appointment_source as enum ('ai_phone', 'website', 'manual', 'walk_in', 'rebooking');
create type price_type as enum ('fixed', 'starting_at');
create type consent_type as enum ('sms_transactional', 'sms_marketing', 'photo', 'email_marketing');
create type language_code as enum ('en', 'vi');
create type photo_angle as enum ('front', 'side', 'back', 'other');

-- ---------- platform ----------
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  included_ai_minutes integer not null default 0,
  included_sms integer not null default 0,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- tenants ----------
create table salons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  name text not null,
  timezone text not null default 'America/Chicago',
  phone_e164 text,
  address text,
  website_url text,
  custom_booking_domain text unique,
  logo_url text,
  brand jsonb not null default '{}'::jsonb,         -- {primary, accent, background}
  is_demo boolean not null default false,
  status text not null default 'active' check (status in ('trial', 'active', 'suspended', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table salon_settings (
  salon_id uuid primary key references salons(id) on delete cascade,
  default_language language_code not null default 'en',
  supported_languages language_code[] not null default array['en', 'vi']::language_code[],
  slot_interval_minutes integer not null default 15 check (slot_interval_minutes between 5 and 60),
  min_booking_notice_minutes integer not null default 60 check (min_booking_notice_minutes >= 0),
  max_advance_days integer not null default 60 check (max_advance_days between 1 and 365),
  hold_minutes integer not null default 5 check (hold_minutes between 1 and 30),
  -- weekly hours: {"0":[{"open":"12:00","close":"17:00"}], "1":[...], ...}  0 = Sunday
  business_hours jsonb not null default '{}'::jsonb,
  closed_dates date[] not null default '{}',
  cancellation_policy text,
  manage_link_ttl_days integer not null default 30,
  notification_settings jsonb not null default '{"confirmation":true,"reminder_24h":true,"reminder_2h":false}'::jsonb,
  ai_settings jsonb not null default '{}'::jsonb,
  quiet_hours jsonb not null default '{"start":"20:00","end":"09:00"}'::jsonb,
  updated_at timestamptz not null default now()
);

create table salon_memberships (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role membership_role not null,
  staff_id uuid,                                   -- link to a staff row if this user cuts hair
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  plan_id uuid not null references subscription_plans(id),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  external_billing_id text,                        -- Stripe (Phase 4)
  created_at timestamptz not null default now()
);

-- ---------- staff & services ----------
create table staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  display_name text not null,
  phone_e164 text,
  color text not null default '#C9A96E',
  is_active boolean not null default true,
  is_bookable_online boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (salon_id, id)
);
alter table salon_memberships
  add constraint salon_memberships_staff_fk foreign key (salon_id, staff_id) references staff(salon_id, id);

create table staff_working_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  foreign key (salon_id, staff_id) references staff(salon_id, id) on delete cascade
);
create index on staff_working_hours (staff_id, weekday);

create table staff_time_off (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'personal' check (kind in ('break', 'lunch', 'personal', 'vacation', 'holiday')),
  note text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  foreign key (salon_id, staff_id) references staff(salon_id, id) on delete cascade
);
create index on staff_time_off using gist (staff_id, tstzrange(starts_at, ends_at));

create table services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  name_en text not null,
  name_vi text not null,
  description_en text,
  description_vi text,
  price_cents integer not null check (price_cents >= 0),
  price_type price_type not null default 'fixed',
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  processing_minutes integer not null default 0 check (processing_minutes >= 0),
  cleanup_minutes integer not null default 0 check (cleanup_minutes >= 0),
  requires_approval boolean not null default false,
  ai_bookable boolean not null default true,
  online_bookable boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (salon_id, id)
);

create table service_addons (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  service_id uuid not null,
  name_en text not null,
  name_vi text not null,
  price_cents integer not null check (price_cents >= 0),
  extra_minutes integer not null default 0 check (extra_minutes >= 0),
  is_active boolean not null default true,
  foreign key (salon_id, service_id) references services(salon_id, id) on delete cascade
);

create table staff_services (
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  duration_minutes_override integer check (duration_minutes_override between 5 and 480),
  primary key (staff_id, service_id),
  foreign key (salon_id, staff_id) references staff(salon_id, id) on delete cascade,
  foreign key (salon_id, service_id) references services(salon_id, id) on delete cascade
);

-- ---------- customers ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  first_name text not null,
  last_name text,
  phone_e164 text,                                  -- NOT unique: households share phones
  email text,
  preferred_language language_code not null default 'en',
  preferred_staff_id uuid,
  birthday date,
  household_primary boolean not null default false,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  completed_visits integer not null default 0,
  lifetime_spend_cents integer not null default 0,
  notes text,
  is_synthetic boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, id),
  foreign key (salon_id, preferred_staff_id) references staff(salon_id, id)
);
create index customers_salon_phone_idx on customers (salon_id, phone_e164);
create index customers_salon_name_idx on customers (salon_id, lower(first_name), lower(last_name));

create table customer_preferences (
  customer_id uuid primary key,
  salon_id uuid not null references salons(id) on delete cascade,
  preferred_service_ids uuid[] not null default '{}',
  usual_service_id uuid,
  typical_interval_days integer,
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);

create table customer_consents (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid not null,
  consent consent_type not null,
  granted boolean not null,
  method text not null,                             -- 'web_checkbox' | 'verbal_in_salon' | 'sms_keyword' | 'ai_call'
  recorded_by uuid references auth.users(id),
  recorded_at timestamptz not null default now(),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);
create index on customer_consents (customer_id, consent, recorded_at desc);

create table communication_preferences (
  customer_id uuid primary key,
  salon_id uuid not null references salons(id) on delete cascade,
  sms_opt_out boolean not null default false,       -- STOP keyword
  sms_opt_out_at timestamptz,
  reminder_24h boolean not null default true,
  reminder_2h boolean not null default false,
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);

create table haircut_profiles (
  customer_id uuid primary key,
  salon_id uuid not null references salons(id) on delete cascade,
  style text,
  clipper_guard text,
  fade_type text,
  side_length text,
  top_length text,
  back_length text,
  scissor_notes text,
  hairline text,
  beard text,
  color_formula text,
  products text,
  stylist_notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);

-- Append-only: each visit snapshot. Never overwritten.
create table haircut_history (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid not null,
  appointment_id uuid,
  staff_id uuid,
  cut_on date not null,
  snapshot jsonb not null,                          -- copy of haircut_profiles fields at that visit
  customer_feedback text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (salon_id, id),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);
create index on haircut_history (customer_id, cut_on desc);

create table haircut_photos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid not null,
  haircut_history_id uuid,
  angle photo_angle not null,
  storage_path text not null unique,                -- {salon_id}/{customer_id}/{uuid}.jpg
  consent_id uuid not null references customer_consents(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade,
  foreign key (salon_id, haircut_history_id) references haircut_history(salon_id, id) on delete set null (haircut_history_id)
);

-- ---------- appointments ----------
create table appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,                     -- service end (customer-facing)
  blocked_until timestamptz not null,               -- ends_at + cleanup (staff unavailable until)
  status appointment_status not null default 'booked',
  source appointment_source not null,
  idempotency_key text,
  estimated_price_cents integer not null default 0,
  final_price_cents integer,
  customer_note text,
  internal_note text,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, id),
  check (ends_at > starts_at and blocked_until >= ends_at),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete set null (customer_id),
  foreign key (salon_id, staff_id) references staff(salon_id, id),
  -- THE double-booking guarantee: no two active appointments for one staff member may overlap.
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  ) where (status not in ('canceled', 'no_show'))
);
create unique index appointments_idempotency_idx on appointments (salon_id, idempotency_key) where idempotency_key is not null;
create index appointments_salon_start_idx on appointments (salon_id, starts_at);
create index appointments_customer_idx on appointments (customer_id, starts_at desc);

create table appointment_services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  appointment_id uuid not null,
  service_id uuid,
  addon_id uuid references service_addons(id) on delete set null,
  name_snapshot text not null,
  price_cents_snapshot integer not null,
  price_type_snapshot price_type not null,
  duration_minutes_snapshot integer not null,
  foreign key (salon_id, appointment_id) references appointments(salon_id, id) on delete cascade,
  foreign key (salon_id, service_id) references services(salon_id, id) on delete set null (service_id)
);
create index on appointment_services (appointment_id);

create table appointment_holds (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  staff_id uuid not null,
  starts_at timestamptz not null,
  blocked_until timestamptz not null,
  hold_token text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (salon_id, staff_id) references staff(salon_id, id) on delete cascade
);
create index on appointment_holds using gist (staff_id, tstzrange(starts_at, blocked_until));

create table appointment_status_history (
  id bigint generated always as identity primary key,
  salon_id uuid not null references salons(id) on delete cascade,
  appointment_id uuid not null,
  from_status appointment_status,
  to_status appointment_status not null,
  changed_by uuid references auth.users(id),
  channel appointment_source,
  note text,
  changed_at timestamptz not null default now(),
  foreign key (salon_id, appointment_id) references appointments(salon_id, id) on delete cascade
);
create index on appointment_status_history (appointment_id, changed_at);

-- ---------- growth / comms / AI (tables created now; features land in Phase 2–3) ----------
create table waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid,
  service_id uuid,
  staff_id uuid,
  preferred_date date not null,
  window_start time not null,
  window_end time not null,
  contact_phone_e164 text not null,
  notify_permission boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'notified', 'booked', 'expired', 'removed')),
  created_at timestamptz not null default now(),
  foreign key (salon_id, customer_id) references customers(salon_id, id) on delete cascade
);
create index on waitlist_entries (salon_id, preferred_date, status);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid,
  appointment_id uuid,
  channel text not null default 'sms',
  category text not null check (category in ('transactional', 'marketing', 'verification')),
  template text not null,
  to_address text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'suppressed', 'test_mode')),
  provider text,
  provider_message_id text,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  segments integer,
  created_at timestamptz not null default now()
);
create index on notifications (salon_id, scheduled_for) where status = 'queued';

create table ai_call_logs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  provider text not null,
  external_call_id text not null,
  from_e164 text,
  language language_code,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  outcome text check (outcome in ('booked', 'rescheduled', 'canceled', 'info', 'transferred', 'callback', 'abandoned', 'failed')),
  appointment_id uuid,
  transcript jsonb,
  cost_cents integer,
  created_at timestamptz not null default now(),
  unique (provider, external_call_id)
);

create table callback_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid,
  phone_e164 text not null,
  name text,
  reason text,
  language language_code,
  ai_call_id uuid references ai_call_logs(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table usage_records (
  id bigint generated always as identity primary key,
  salon_id uuid not null references salons(id) on delete cascade,
  metric text not null check (metric in ('ai_minutes', 'sms_segments', 'storage_mb')),
  quantity numeric not null,
  cost_cents integer,
  period_month date not null,
  source_id text,
  recorded_at timestamptz not null default now()
);
create index on usage_records (salon_id, period_month, metric);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  salon_id uuid references salons(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now(),
  unique (provider, external_id)
);

create table phone_verifications (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  phone_e164 text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index on phone_verifications (salon_id, phone_e164, created_at desc);

create table support_access_grants (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),      -- salon owner approval
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigint generated always as identity primary key,
  salon_id uuid references salons(id) on delete set null,
  actor_user_id uuid,
  actor_kind text not null check (actor_kind in ('staff', 'customer', 'ai_agent', 'system', 'platform_admin')),
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs (salon_id, created_at desc);

-- ---------- updated_at trigger ----------
create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger salons_updated before update on salons for each row execute function set_updated_at();
create trigger customers_updated before update on customers for each row execute function set_updated_at();
create trigger appointments_updated before update on appointments for each row execute function set_updated_at();
