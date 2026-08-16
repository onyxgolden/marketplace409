insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-photos', 'rental-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

alter table rental_units add column if not exists photo_bucket text;
alter table rental_units add column if not exists photo_object_path text;
alter table rental_tenants add column if not exists photo_bucket text;
alter table rental_tenants add column if not exists photo_object_path text;

create policy "rental_photo_objects_owner_select" on storage.objects for select to authenticated
  using(bucket_id='rental-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "rental_photo_objects_owner_insert" on storage.objects for insert to authenticated
  with check(bucket_id='rental-photos' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "rental_photo_objects_owner_delete" on storage.objects for delete to authenticated
  using(bucket_id='rental-photos' and (storage.foldername(name))[1]=auth.uid()::text);
