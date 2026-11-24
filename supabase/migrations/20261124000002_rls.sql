-- 0002 Row Level Security. Tenant isolation is enforced here, not in app code.
-- Customers (public booking) NEVER touch tables directly: `anon` has no privileges at all.
-- Public endpoints run server-side with the service role after Zod validation.

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Member of the salon (optionally with one of the given roles), OR a platform admin holding an
-- owner-approved, unexpired support grant. Platform admins get NO implicit customer-data access.
create function public.has_salon_role(p_salon uuid, p_roles membership_role[] default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from salon_memberships m
    where m.salon_id = p_salon and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  ) or exists (
    select 1 from support_access_grants g
    join platform_admins pa on pa.user_id = g.admin_user_id
    where g.salon_id = p_salon and g.admin_user_id = auth.uid()
      and g.approved_by is not null and g.expires_at > now()
  );
$$;

revoke all on function public.has_salon_role(uuid, membership_role[]) from public, anon;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.has_salon_role(uuid, membership_role[]) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;

-- Enable RLS on every table in public.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ----- Operational tables: any salon member reads; front-line roles write. -----
do $$
declare t text;
begin
  foreach t in array array[
    'customers', 'customer_preferences', 'customer_consents', 'communication_preferences',
    'haircut_profiles', 'haircut_history', 'haircut_photos',
    'appointments', 'appointment_services', 'appointment_holds',
    'waitlist_entries', 'callback_requests'
  ] loop
    execute format($f$
      create policy %1$s_member_select on public.%1$I for select to authenticated
        using (public.has_salon_role(salon_id));
      create policy %1$s_member_insert on public.%1$I for insert to authenticated
        with check (public.has_salon_role(salon_id));
      create policy %1$s_member_update on public.%1$I for update to authenticated
        using (public.has_salon_role(salon_id)) with check (public.has_salon_role(salon_id));
      create policy %1$s_manager_delete on public.%1$I for delete to authenticated
        using (public.has_salon_role(salon_id, array['owner','manager']::membership_role[]));
    $f$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ----- Configuration tables: members read; owner/manager write. -----
do $$
declare t text;
begin
  foreach t in array array[
    'salon_settings', 'staff', 'staff_working_hours', 'staff_time_off',
    'services', 'service_addons', 'staff_services'
  ] loop
    execute format($f$
      create policy %1$s_member_select on public.%1$I for select to authenticated
        using (public.has_salon_role(salon_id));
      create policy %1$s_manager_write on public.%1$I for all to authenticated
        using (public.has_salon_role(salon_id, array['owner','manager']::membership_role[]))
        with check (public.has_salon_role(salon_id, array['owner','manager']::membership_role[]));
    $f$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Stylists may block their own time (lunch, personal) even though staff_time_off is config.
create policy staff_time_off_self_write on public.staff_time_off for all to authenticated
  using (exists (select 1 from salon_memberships m where m.user_id = auth.uid()
                 and m.salon_id = staff_time_off.salon_id and m.staff_id = staff_time_off.staff_id))
  with check (exists (select 1 from salon_memberships m where m.user_id = auth.uid()
                 and m.salon_id = staff_time_off.salon_id and m.staff_id = staff_time_off.staff_id));

-- ----- Read-only for members (written by server/triggers only). -----
create policy appointment_status_history_select on public.appointment_status_history
  for select to authenticated using (public.has_salon_role(salon_id));
grant select on public.appointment_status_history to authenticated;

create policy notifications_select on public.notifications
  for select to authenticated using (public.has_salon_role(salon_id, array['owner','manager']::membership_role[]));
grant select on public.notifications to authenticated;

create policy ai_call_logs_select on public.ai_call_logs
  for select to authenticated using (public.has_salon_role(salon_id, array['owner','manager']::membership_role[]));
grant select on public.ai_call_logs to authenticated;

create policy usage_records_select on public.usage_records
  for select to authenticated using (public.has_salon_role(salon_id, array['owner']::membership_role[]) or public.is_platform_admin());
grant select on public.usage_records to authenticated;

create policy audit_logs_select on public.audit_logs
  for select to authenticated using (public.has_salon_role(salon_id, array['owner']::membership_role[]) or public.is_platform_admin());
grant select on public.audit_logs to authenticated;

-- ----- Tenancy & platform -----
create policy salons_select on public.salons for select to authenticated
  using (public.has_salon_role(id) or public.is_platform_admin());
create policy salons_owner_update on public.salons for update to authenticated
  using (public.has_salon_role(id, array['owner']::membership_role[]) or public.is_platform_admin())
  with check (public.has_salon_role(id, array['owner']::membership_role[]) or public.is_platform_admin());
create policy salons_admin_insert on public.salons for insert to authenticated
  with check (public.is_platform_admin());
grant select, insert, update on public.salons to authenticated;

create policy memberships_select on public.salon_memberships for select to authenticated
  using (user_id = auth.uid() or public.has_salon_role(salon_id, array['owner','manager']::membership_role[]) or public.is_platform_admin());
create policy memberships_owner_write on public.salon_memberships for all to authenticated
  using (public.has_salon_role(salon_id, array['owner']::membership_role[]) or public.is_platform_admin())
  with check (public.has_salon_role(salon_id, array['owner']::membership_role[]) or public.is_platform_admin());
grant select, insert, update, delete on public.salon_memberships to authenticated;

create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());
grant select on public.platform_admins to authenticated;

create policy plans_read on public.subscription_plans for select to authenticated using (true);
grant select on public.subscription_plans to authenticated;

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.has_salon_role(salon_id, array['owner']::membership_role[]) or public.is_platform_admin());
grant select on public.subscriptions to authenticated;

create policy support_grants_select on public.support_access_grants for select to authenticated
  using (admin_user_id = auth.uid() or public.has_salon_role(salon_id, array['owner']::membership_role[]));
create policy support_grants_owner_approve on public.support_access_grants for update to authenticated
  using (public.has_salon_role(salon_id, array['owner']::membership_role[]))
  with check (public.has_salon_role(salon_id, array['owner']::membership_role[]));
grant select, update on public.support_access_grants to authenticated;

-- phone_verifications, webhook_events: no client policies at all (service role only).
