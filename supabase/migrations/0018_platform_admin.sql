-- 0018 Platform Super Admin (Phase 10): a cross-tenant console for the SaaS operator.
-- Platform admins are NOT tenant-scoped; they can list tenants and suspend/reactivate them.
-- They do NOT get access to any tenant's CRM data — only counts + lifecycle controls.
-- Run after 0001-0017. Idempotent.
--
-- ⚠️ SEEDING: there is intentionally no UI/RPC to grant platform-admin. After running this,
-- add yourself in the SQL Editor (run as the table owner, which bypasses RLS):
--     insert into public.platform_admins(user_id)
--     select id from auth.users where email = 'you@example.com'
--     on conflict do nothing;

-- ───────────────────────── Table ─────────────────────────
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;

-- Self-read only; no client write policy (seed via SQL Editor / service role).
drop policy if exists pa_self_read on public.platform_admins;
create policy pa_self_read on public.platform_admins
  for select using (user_id = auth.uid());

-- ───────────────────────── Helper ─────────────────────────
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- Constrain tenant lifecycle status (column already exists from 0001).
alter table public.tenants drop constraint if exists tenants_status_chk;
alter table public.tenants add constraint tenants_status_chk check (status in ('active','suspended'));

-- ───────────────────────── Cross-tenant RPCs ─────────────────────────
-- Each verifies is_platform_admin() before doing anything.
create or replace function public.admin_list_tenants()
returns table (
  id         uuid,
  name       text,
  slug       text,
  status     text,
  plan_tier  text,
  created_at timestamptz,
  members    bigint,
  leads      bigint,
  deals      bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;
  return query
    select t.id, t.name, t.slug, t.status, t.plan_tier, t.created_at,
           (select count(*) from public.profiles p where p.tenant_id = t.id),
           (select count(*) from public.leads l where l.tenant_id = t.id and l.deleted_at is null),
           (select count(*) from public.deals d where d.tenant_id = t.id and d.deleted_at is null)
    from public.tenants t
    where t.deleted_at is null
    order by t.created_at desc;
end; $$;
grant execute on function public.admin_list_tenants() to authenticated;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('active','suspended') then
    raise exception 'Invalid status: %', p_status;
  end if;
  update public.tenants set status = p_status where id = p_tenant and deleted_at is null;
end; $$;
grant execute on function public.admin_set_tenant_status(uuid, text) to authenticated;
