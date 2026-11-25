-- Create a REAL salon tenant (e.g. your first pilot). Edit the values in the DECLARE block, then run it
-- once in the Supabase SQL editor. Services start from a typical barbershop menu: edit prices/durations
-- with the owner before launch. Safe to keep the demo salon alongside — it's a separate tenant.
do $$
declare
  v_slug        text := 'yoursalon';                      -- URL: /book/yoursalon  (a-z, 0-9, dashes)
  v_name        text := 'Your Salon Name';
  v_phone       text := '+15555550123';                   -- salon's public phone, E.164
  v_address     text := 'Street, City, ST';
  v_timezone    text := 'America/Chicago';
  v_owner_name  text := 'Owner';                          -- first name shown in texts / calendar
  v_owner_email text := 'owner@example.com';              -- must already be invited in Auth → Users
  v_salon uuid;
  v_owner_staff uuid;
  v_user uuid;
begin
  insert into salons (slug, name, timezone, phone_e164, address, is_demo, status, owner_first_name)
  values (v_slug, v_name, v_timezone, v_phone, v_address, false, 'trial', v_owner_name)
  returning id into v_salon;

  insert into salon_settings (salon_id, business_hours) values (v_salon, '{
    "0": [{"open":"12:00","close":"17:00"}],
    "1": [{"open":"10:00","close":"19:00"}], "2": [{"open":"10:00","close":"19:00"}],
    "3": [{"open":"10:00","close":"19:00"}], "4": [{"open":"10:00","close":"19:00"}],
    "5": [{"open":"10:00","close":"19:00"}], "6": [{"open":"10:00","close":"19:00"}]
  }'::jsonb);

  insert into services (salon_id, name_en, name_vi, price_cents, price_type, duration_minutes, cleanup_minutes, requires_approval, sort_order)
  values
    (v_salon, 'Men''s haircut', 'Cắt tóc nam', 3000, 'starting_at', 30, 0, false, 1),
    (v_salon, 'Women''s haircut', 'Cắt tóc nữ', 4500, 'starting_at', 45, 0, false, 2),
    (v_salon, 'Beard trim', 'Tỉa râu', 2000, 'fixed', 15, 0, false, 3),
    (v_salon, 'Child haircut', 'Cắt tóc trẻ em', 2500, 'fixed', 30, 0, false, 4),
    (v_salon, 'Color', 'Nhuộm tóc', 8000, 'starting_at', 120, 10, true, 5),
    (v_salon, 'Senior haircut', 'Cắt tóc người cao tuổi', 2000, 'fixed', 30, 0, false, 6);

  insert into staff (salon_id, display_name, sort_order) values (v_salon, v_owner_name, 1) returning id into v_owner_staff;
  insert into staff_working_hours (salon_id, staff_id, weekday, start_time, end_time)
  select v_salon, v_owner_staff, d, case when d = 0 then '12:00'::time else '10:00'::time end,
         case when d = 0 then '17:00'::time else '19:00'::time end
    from generate_series(0, 6) d;
  insert into staff_services (salon_id, staff_id, service_id) select v_salon, v_owner_staff, id from services where salon_id = v_salon;

  select id into v_user from auth.users where email = lower(v_owner_email);
  if v_user is null then
    raise notice 'Owner % not found in auth.users — invite them, then insert into salon_memberships manually.', v_owner_email;
  else
    insert into salon_memberships (salon_id, user_id, role, staff_id) values (v_salon, v_user, 'owner', v_owner_staff);
  end if;
  raise notice 'Created salon % (%): /book/%', v_name, v_salon, v_slug;
end $$;
