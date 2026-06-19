-- 0025 Branding asset storage: a public bucket for tenant logos / favicons /
-- login backgrounds, with tenant-scoped admin-only writes.
--
-- Path convention (IMPORTANT): objects are uploaded as `<tenant_id>/<kind>-<uuid>.<ext>`.
-- The bucket name is NOT part of the object `name`, so (storage.foldername(name))[1]
-- is the tenant id. Do NOT prepend "branding/" to the upload path or the policy
-- check shifts by one segment and every write is rejected.
--
-- Reads are PUBLIC by design: logos and the login background must render before
-- authentication (on /login). Never store anything sensitive in this bucket.

-- 1. Bucket (idempotent). The `public` flag is what lets getPublicUrl resolve. -----
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do update set public = true;

-- 2. Policies on storage.objects, scoped to this bucket. --------------------------
-- Public read.
drop policy if exists branding_public_read on storage.objects;
create policy branding_public_read on storage.objects
  for select using (bucket_id = 'branding');

-- Admin INSERT into the caller's own tenant folder.
drop policy if exists branding_admin_insert on storage.objects;
create policy branding_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.is_admin()
  );

-- Admin UPDATE (needed because uploads use upsert:true → UPDATE on conflict).
drop policy if exists branding_admin_update on storage.objects;
create policy branding_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.is_admin()
  )
  with check (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.is_admin()
  );

-- Admin DELETE (replace/remove an asset).
drop policy if exists branding_admin_delete on storage.objects;
create policy branding_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.is_admin()
  );
