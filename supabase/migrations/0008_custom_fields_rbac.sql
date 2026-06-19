-- 0008 Custom Fields: constrain the allowed data types and make field-definition
-- management admin-only (reads stay open so fields render for every tenant member).
-- Run after 0001-0007. The custom_field_definitions table + custom_fields jsonb
-- columns already exist (0003 / 0002); this only tightens them.

-- 1. Guard the supported data types (table is empty, so this is safe to add). -----
alter table public.custom_field_definitions
  drop constraint if exists cfd_data_type_chk;
alter table public.custom_field_definitions
  add constraint cfd_data_type_chk
  check (data_type in ('text','number','date','email','url','tel','select'));

-- 2. Tighten RLS: everyone in the tenant may READ definitions (so custom fields
--    render on records for all roles); only admins may create/edit/delete them.
--    Mirrors the user_roles pattern from 0007.
drop policy if exists tenant_isolation on public.custom_field_definitions;
drop policy if exists cfd_read on public.custom_field_definitions;
drop policy if exists cfd_admin_write on public.custom_field_definitions;

create policy cfd_read on public.custom_field_definitions
  for select using (tenant_id = public.current_tenant_id());

create policy cfd_admin_write on public.custom_field_definitions
  for all
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
