-- 0003 Transactional booking, status audit trail, and data-retention helpers.

-- Every status change is recorded, whoever made it (web, AI, staff, SQL console).
create function public.log_appointment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into appointment_status_history (salon_id, appointment_id, from_status, to_status, changed_by, channel)
    values (new.salon_id, new.id, null, new.status, new.created_by, new.source);
    insert into audit_logs (salon_id, actor_user_id, actor_kind, action, entity, entity_id, details)
    values (new.salon_id, new.created_by,
            case when new.source = 'ai_phone' then 'ai_agent' when new.source = 'website' then 'customer' else 'staff' end,
            'appointment.created', 'appointment', new.id,
            jsonb_build_object('starts_at', new.starts_at, 'staff_id', new.staff_id, 'source', new.source));
  elsif new.status is distinct from old.status or new.starts_at is distinct from old.starts_at
        or new.staff_id is distinct from old.staff_id then
    if new.status is distinct from old.status then
      insert into appointment_status_history (salon_id, appointment_id, from_status, to_status, changed_by)
      values (new.salon_id, new.id, old.status, new.status, auth.uid());
    end if;
    insert into audit_logs (salon_id, actor_user_id, actor_kind, action, entity, entity_id, details)
    values (new.salon_id, auth.uid(), 'staff', 'appointment.updated', 'appointment', new.id,
            jsonb_build_object('from', jsonb_build_object('status', old.status, 'starts_at', old.starts_at, 'staff_id', old.staff_id),
                               'to',   jsonb_build_object('status', new.status, 'starts_at', new.starts_at, 'staff_id', new.staff_id)));
  end if;
  return new;
end $$;

create trigger appointments_status_audit
  after insert or update on appointments
  for each row execute function public.log_appointment_status();

-- Book an appointment atomically.
--   * Idempotent on (salon_id, idempotency_key).
--   * Serialised per staff member with a transaction-scoped advisory lock.
--   * Rejects staff time off and other people's unexpired holds.
--   * The EXCLUDE constraint on appointments is the final guarantee even if this logic has a bug.
-- Errors are raised with stable message codes the API maps to HTTP responses:
--   SLOT_TAKEN, SLOT_HELD, STAFF_UNAVAILABLE, STAFF_NOT_QUALIFIED, INVALID_SERVICE, INVALID_STAFF, INVALID_CUSTOMER
create function public.book_appointment(
  p_salon_id uuid,
  p_staff_id uuid,
  p_customer_id uuid,
  p_starts_at timestamptz,
  p_service_ids uuid[],
  p_source appointment_source,
  p_idempotency_key text,
  p_customer_note text default null,
  p_hold_token text default null,
  p_actor uuid default null,
  p_initial_status appointment_status default null
) returns table (appointment_id uuid, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
  v_duration integer;
  v_cleanup integer;
  v_price integer;
  v_needs_approval boolean;
  v_count integer;
  v_qualified integer;
  v_ends timestamptz;
  v_blocked timestamptz;
  v_id uuid;
  v_is_demo boolean;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select a.id into v_existing from appointments a
   where a.salon_id = p_salon_id and a.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing, false; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text, 42));

  -- Re-check after acquiring the lock (a concurrent retry may have just committed).
  select a.id into v_existing from appointments a
   where a.salon_id = p_salon_id and a.idempotency_key = p_idempotency_key;
  if found then
    return query select v_existing, false; return;
  end if;

  select s.is_demo into v_is_demo from salons s where s.id = p_salon_id;
  if not found then raise exception 'INVALID_SALON'; end if;

  perform 1 from staff st where st.id = p_staff_id and st.salon_id = p_salon_id and st.is_active;
  if not found then raise exception 'INVALID_STAFF'; end if;

  if p_customer_id is not null then
    perform 1 from customers c where c.id = p_customer_id and c.salon_id = p_salon_id;
    if not found then raise exception 'INVALID_CUSTOMER'; end if;
  end if;

  select count(*),
         coalesce(sum(coalesce(ss.duration_minutes_override, sv.duration_minutes)), 0),
         coalesce(max(sv.cleanup_minutes), 0),
         coalesce(sum(sv.price_cents), 0),
         coalesce(bool_or(sv.requires_approval), false),
         count(ss.service_id)
    into v_count, v_duration, v_cleanup, v_price, v_needs_approval, v_qualified
    from unnest(p_service_ids) as want(id)
    join services sv on sv.id = want.id and sv.salon_id = p_salon_id and sv.is_active
    left join staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff_id;

  if coalesce(array_length(p_service_ids, 1), 0) = 0 then raise exception 'INVALID_SERVICE'; end if;
  if (select count(*) from services sv where sv.id = any (p_service_ids) and sv.salon_id = p_salon_id and sv.is_active)
     <> array_length(p_service_ids, 1) then
    raise exception 'INVALID_SERVICE';
  end if;
  if v_qualified <> array_length(p_service_ids, 1) then raise exception 'STAFF_NOT_QUALIFIED'; end if;

  v_ends := p_starts_at + make_interval(mins => v_duration);
  v_blocked := v_ends + make_interval(mins => v_cleanup);

  perform 1 from staff_time_off t
   where t.staff_id = p_staff_id
     and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, v_blocked, '[)');
  if found then raise exception 'STAFF_UNAVAILABLE'; end if;

  delete from appointment_holds h where h.expires_at <= now();
  perform 1 from appointment_holds h
   where h.staff_id = p_staff_id
     and (p_hold_token is null or h.hold_token <> p_hold_token)
     and tstzrange(h.starts_at, h.blocked_until, '[)') && tstzrange(p_starts_at, v_blocked, '[)');
  if found then raise exception 'SLOT_HELD'; end if;

  begin
    insert into appointments (salon_id, customer_id, staff_id, starts_at, ends_at, blocked_until, status, source,
                              idempotency_key, estimated_price_cents, customer_note, created_by, is_demo)
    values (p_salon_id, p_customer_id, p_staff_id, p_starts_at, v_ends, v_blocked,
            coalesce(p_initial_status, case when v_needs_approval then 'pending_approval'::appointment_status else 'booked'::appointment_status end),
            p_source, p_idempotency_key, v_price, p_customer_note, p_actor, v_is_demo)
    returning id into v_id;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN';
  end;

  insert into appointment_services (salon_id, appointment_id, service_id, name_snapshot, price_cents_snapshot,
                                    price_type_snapshot, duration_minutes_snapshot)
  select p_salon_id, v_id, sv.id, sv.name_en, sv.price_cents, sv.price_type,
         coalesce(ss.duration_minutes_override, sv.duration_minutes)
    from unnest(p_service_ids) with ordinality as want(id, ord)
    join services sv on sv.id = want.id
    left join staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff_id
   order by want.ord;

  if p_hold_token is not null then
    delete from appointment_holds h where h.hold_token = p_hold_token;
  end if;

  return query select v_id, true;
end $$;

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz, uuid[], appointment_source, text, text, text, uuid, appointment_status)
  from public, anon, authenticated;

-- Short-lived hold while a customer finishes the booking form.
create function public.create_appointment_hold(
  p_salon_id uuid, p_staff_id uuid, p_starts_at timestamptz, p_blocked_until timestamptz, p_minutes integer default 5
) returns text
language plpgsql security definer set search_path = public as $$
declare v_token text := encode(gen_random_bytes(18), 'base64');
begin
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text, 42));
  delete from appointment_holds where expires_at <= now();
  perform 1 from appointments a
   where a.staff_id = p_staff_id and a.status not in ('canceled', 'no_show')
     and tstzrange(a.starts_at, a.blocked_until, '[)') && tstzrange(p_starts_at, p_blocked_until, '[)');
  if found then raise exception 'SLOT_TAKEN'; end if;
  perform 1 from appointment_holds h
   where h.staff_id = p_staff_id and tstzrange(h.starts_at, h.blocked_until, '[)') && tstzrange(p_starts_at, p_blocked_until, '[)');
  if found then raise exception 'SLOT_HELD'; end if;
  insert into appointment_holds (salon_id, staff_id, starts_at, blocked_until, hold_token, expires_at)
  values (p_salon_id, p_staff_id, p_starts_at, p_blocked_until, v_token, now() + make_interval(mins => p_minutes));
  return v_token;
end $$;
revoke all on function public.create_appointment_hold(uuid, uuid, timestamptz, timestamptz, integer) from public, anon, authenticated;

-- Right-to-delete: remove PII and photos, keep anonymised appointment rows for revenue history.
-- Storage objects must be deleted by the server (Storage API) using the returned paths.
create function public.anonymize_customer(p_salon_id uuid, p_customer_id uuid)
returns setof text
language plpgsql security definer set search_path = public as $$
begin
  return query delete from haircut_photos where salon_id = p_salon_id and customer_id = p_customer_id returning storage_path;
  delete from haircut_history where salon_id = p_salon_id and customer_id = p_customer_id;
  delete from haircut_profiles where salon_id = p_salon_id and customer_id = p_customer_id;
  delete from customer_preferences where salon_id = p_salon_id and customer_id = p_customer_id;
  delete from communication_preferences where salon_id = p_salon_id and customer_id = p_customer_id;
  update appointments set customer_note = null where salon_id = p_salon_id and customer_id = p_customer_id;
  update customers set first_name = 'Deleted', last_name = null, phone_e164 = null, email = null,
                       birthday = null, notes = null, anonymized_at = now()
   where salon_id = p_salon_id and id = p_customer_id;
  insert into audit_logs (salon_id, actor_kind, action, entity, entity_id)
  values (p_salon_id, 'system', 'customer.anonymized', 'customer', p_customer_id);
end $$;
revoke all on function public.anonymize_customer(uuid, uuid) from public, anon, authenticated;
