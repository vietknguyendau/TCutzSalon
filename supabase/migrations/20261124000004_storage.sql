-- 0004 Private haircut photo storage. Object path convention: {salon_id}/{customer_id}/{uuid}.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('haircut-photos', 'haircut-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy haircut_photos_member_read on storage.objects for select to authenticated
  using (bucket_id = 'haircut-photos'
         and public.has_salon_role(((storage.foldername(name))[1])::uuid));

-- Upload only when the customer has an active photo consent.
create policy haircut_photos_member_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'haircut-photos'
    and public.has_salon_role(((storage.foldername(name))[1])::uuid)
    and exists (
      select 1 from public.customer_consents c
      where c.salon_id = ((storage.foldername(name))[1])::uuid
        and c.customer_id = ((storage.foldername(name))[2])::uuid
        and c.consent = 'photo'
        and c.granted
        and c.recorded_at = (select max(c2.recorded_at) from public.customer_consents c2
                             where c2.customer_id = c.customer_id and c2.consent = 'photo')
    )
  );

create policy haircut_photos_manager_delete on storage.objects for delete to authenticated
  using (bucket_id = 'haircut-photos'
         and public.has_salon_role(((storage.foldername(name))[1])::uuid, array['owner','manager']::membership_role[]));
