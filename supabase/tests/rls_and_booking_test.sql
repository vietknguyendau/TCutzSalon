-- Assertions for tenant isolation, overlap protection and idempotency. Fails loudly on any violation.
\set ON_ERROR_STOP on
begin;

-- Fixtures: a second salon, and two users (Tcutz owner, other-salon owner).
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'diem@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'other@example.test'),
  ('cccccccc-0000-4000-8000-000000000003', 'admin@example.test');
insert into salons (id, slug, name) values ('99999999-0000-4000-8000-000000000009', 'other-salon', 'Other Salon');
insert into customers (salon_id, first_name, phone_e164, is_synthetic)
  values ('99999999-0000-4000-8000-000000000009', 'Secret', '+17635550199', true);
insert into salon_memberships (salon_id, user_id, role) values
  ('00000000-0000-4000-8001-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner'),
  ('99999999-0000-4000-8000-000000000009', 'bbbbbbbb-0000-4000-8000-000000000002', 'owner');
insert into platform_admins (user_id) values ('cccccccc-0000-4000-8000-000000000003');

insert into sms_opt_outs (salon_id, phone_e164, opted_out, source) values
  ('00000000-0000-4000-8001-000000000001', '+17635550177', true, 'sms_keyword'),
  ('99999999-0000-4000-8000-000000000009', '+17635550188', true, 'sms_keyword');
insert into callback_requests (salon_id, phone_e164, reason) values
  ('99999999-0000-4000-8000-000000000009', '+17635550188', 'landline_missed_call');
insert into ai_call_logs (salon_id, provider, external_call_id, from_e164, outcome)
  values ('00000000-0000-4000-8001-000000000001', 'twilio', 'CA-test-1', '+17635550177', 'missed');

-- ---------- Tenant isolation ----------
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
do $$ begin
  if (select count(*) from customers) <> 10 then raise exception 'Tcutz owner should see exactly 10 customers, saw %', (select count(*) from customers); end if;
  if exists (select 1 from customers where first_name = 'Secret') then raise exception 'LEAK: saw other salon customer'; end if;
  if (select count(*) from salons) <> 1 then raise exception 'LEAK: saw other salon row'; end if;
  if (select count(*) from appointments) = 0 then raise exception 'Owner should see own appointments'; end if;
  if (select count(*) from sms_opt_outs) <> 1 then raise exception 'opt-outs: expected only own salon row'; end if;
  if exists (select 1 from callback_requests where phone_e164 = '+17635550188') then raise exception 'LEAK: other salon callbacks'; end if;
  if (select count(*) from ai_call_logs) <> 1 then raise exception 'call logs: expected own call'; end if;
end $$;

-- Clients can't write opt-outs (server-only, so STOP can't be undone by a dashboard bug).
do $$ begin
  begin
    insert into sms_opt_outs (salon_id, phone_e164, opted_out, source) values ('00000000-0000-4000-8001-000000000001', '+17635550199', false, 'staff');
    raise exception 'client insert into sms_opt_outs should fail';
  exception when insufficient_privilege then null; end;
end $$;

-- Cannot write into another tenant.
do $$ begin
  begin
    insert into customers (salon_id, first_name) values ('99999999-0000-4000-8000-000000000009', 'Injected');
    raise exception 'LEAK: cross-tenant insert succeeded';
  exception when insufficient_privilege then null; end;
end $$;

-- Cannot call the booking RPC directly as a client.
do $$ begin
  begin
    perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
      now() + interval '3 days', array['00000000-0000-4000-8003-000000000001']::uuid[], 'website', 'client-direct-01');
    raise exception 'book_appointment should not be executable by authenticated';
  exception when insufficient_privilege then null; end;
end $$;

-- Other salon owner sees only their own.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from customers) <> 1 then raise exception 'Other owner should see 1 customer'; end if;
  if (select count(*) from haircut_profiles) <> 0 then raise exception 'LEAK: haircut profiles'; end if;
  if (select count(*) from appointments) <> 0 then raise exception 'LEAK: appointments'; end if;
end $$;

-- Platform admin WITHOUT a support grant sees no customer data.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);
do $$ begin
  if (select count(*) from customers) <> 0 then raise exception 'Platform admin must not see customers without a grant'; end if;
  if (select count(*) from salons) <> 2 then raise exception 'Platform admin should see salon list'; end if;
end $$;

-- anon sees nothing at all.
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from customers limit 1;
    raise exception 'anon must not read customers';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------- Overlap protection (as service role / owner of tables) ----------
do $$
declare
  v_start timestamptz := date_trunc('hour', now()) + interval '10 days';
  r record;
begin
  select * into r from public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
    v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'website', 'test-overlap-001');
  if not r.was_created then raise exception 'first booking should be created'; end if;

  -- Idempotent retry returns the same id, not a new row.
  if (select appointment_id from public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
        v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'website', 'test-overlap-001')) <> r.appointment_id then
    raise exception 'idempotency key did not return the original appointment';
  end if;

  -- Overlapping booking with a different key is rejected.
  begin
    perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
      v_start + interval '15 minutes', array['00000000-0000-4000-8003-000000000001']::uuid[], 'ai_phone', 'test-overlap-002');
    raise exception 'OVERLAP ACCEPTED';
  exception when raise_exception then
    if sqlerrm <> 'SLOT_TAKEN' then raise; end if;
  end;

  -- Raw insert bypassing the function is ALSO rejected by the exclusion constraint.
  begin
    insert into appointments (salon_id, staff_id, starts_at, ends_at, blocked_until, source)
    values ('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001',
            v_start, v_start + interval '30 minutes', v_start + interval '30 minutes', 'manual');
    raise exception 'RAW OVERLAP ACCEPTED';
  exception when exclusion_violation then null; end;

  -- Back-to-back is fine; a different stylist at the same time is fine.
  perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
    v_start + interval '30 minutes', array['00000000-0000-4000-8003-000000000001']::uuid[], 'manual', 'test-overlap-003');
  perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000002', null,
    v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'manual', 'test-overlap-004');

  -- Unqualified service for a stylist is rejected (Sample Stylist does not do color).
  begin
    perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000002', null,
      v_start + interval '2 hours', array['00000000-0000-4000-8003-000000000005']::uuid[], 'manual', 'test-overlap-005');
    raise exception 'UNQUALIFIED ACCEPTED';
  exception when raise_exception then
    if sqlerrm <> 'STAFF_NOT_QUALIFIED' then raise; end if;
  end;

  -- Canceling frees the slot.
  update appointments set status = 'canceled' where id = r.appointment_id;
  perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
    v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'website', 'test-overlap-006');

  -- Color requires approval → pending_approval.
  if (select status from appointments where id = (select appointment_id from public.book_appointment('00000000-0000-4000-8001-000000000001',
        '00000000-0000-4000-8002-000000000001', null, v_start + interval '1 day', array['00000000-0000-4000-8003-000000000005']::uuid[],
        'website', 'test-overlap-007'))) <> 'pending_approval' then
    raise exception 'approval-required service should be pending_approval';
  end if;

  -- Status history captured.
  if (select count(*) from appointment_status_history where appointment_id = r.appointment_id) <> 2 then
    raise exception 'status history should have created + canceled';
  end if;
end $$;

-- ---------- Holds ----------
do $$
declare v_start timestamptz := date_trunc('hour', now()) + interval '12 days'; v_token text;
begin
  v_token := public.create_appointment_hold('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001',
    v_start, v_start + interval '30 minutes', 5);
  begin
    perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
      v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'ai_phone', 'test-hold-001');
    raise exception 'HELD SLOT ACCEPTED';
  exception when raise_exception then if sqlerrm <> 'SLOT_HELD' then raise; end if; end;
  -- Holder can book it.
  perform public.book_appointment('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001', null,
    v_start, array['00000000-0000-4000-8003-000000000001']::uuid[], 'website', 'test-hold-002', null, v_token);
  if exists (select 1 from appointment_holds where hold_token = v_token) then raise exception 'hold not released'; end if;
end $$;

-- ---------- Phase 2 constraints ----------
do $$ begin
  begin
    insert into ai_call_logs (salon_id, provider, external_call_id, outcome) values ('00000000-0000-4000-8001-000000000001', 'twilio', 'CA-bad', 'nonsense');
    raise exception 'bad outcome accepted';
  exception when check_violation then null; end;
  begin
    insert into webhook_events (provider, external_id, payload) values ('twilio', 'call-ended:CA-dup', '{}');
    insert into webhook_events (provider, external_id, payload) values ('twilio', 'call-ended:CA-dup', '{}');
    raise exception 'duplicate webhook accepted';
  exception when unique_violation then null; end;
  if (select provider_number_e164 from salons where slug = 'tcutz') <> '+17635550100' then raise exception 'seed provider number missing'; end if;
end $$;

-- ---------- Anonymize ----------
do $$ begin
  perform public.anonymize_customer('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8004-000000000001');
  if exists (select 1 from haircut_profiles where customer_id = '00000000-0000-4000-8004-000000000001') then raise exception 'profile not deleted'; end if;
  if (select phone_e164 from customers where id = '00000000-0000-4000-8004-000000000001') is not null then raise exception 'phone not removed'; end if;
end $$;

rollback;
\echo 'ALL DB ASSERTIONS PASSED'
