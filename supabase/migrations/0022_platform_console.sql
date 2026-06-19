-- 0022 Platform Super Admin console (Phase 10 — full build).
-- Extends 0018 (platform_admins + is_platform_admin + suspend/reactivate) into an
-- enterprise operator console: aggregate analytics, tenant provisioning, monitoring,
-- platform settings, feature flags, and a dedicated platform audit trail.
--
-- SECURITY MODEL
--  * Platform admins are NOT tenant members. Every privileged read/write is a
--    SECURITY DEFINER RPC that checks is_platform_admin() FIRST.
--  * Only AGGREGATE counts + tenant metadata are exposed — never CRM business rows
--    (leads/contacts/deals/notes are never returned).
--  * All mutating RPCs write to platform_audit_logs.
-- Run after 0001-0021. Idempotent.

-- ───────────────────────── Platform tables ─────────────────────────
create table if not exists public.platform_audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                         -- platform admin (auth.users)
  action      text not null,                -- e.g. tenant.suspend, tenant.provision
  target_type text,                         -- tenant | platform | feature_flag
  target_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists platform_audit_created_idx on public.platform_audit_logs (created_at desc);

create table if not exists public.platform_settings (
  key        text primary key,             -- 'config'
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.feature_flags (
  key         text primary key,
  label       text not null,
  description text,
  enabled     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Monitoring hook for background jobs (empty now; Billing/AI populate it later).
create table if not exists public.platform_jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,
  status      text not null default 'queued' check (status in ('queued','running','success','failed')),
  detail      jsonb not null default '{}'::jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists platform_jobs_status_idx on public.platform_jobs (status, created_at desc);

-- ───────────────────────── RLS (platform-admin only) ─────────────────────────
alter table public.platform_audit_logs enable row level security;
alter table public.platform_settings   enable row level security;
alter table public.feature_flags        enable row level security;
alter table public.platform_jobs        enable row level security;

drop policy if exists pal_read on public.platform_audit_logs;
create policy pal_read on public.platform_audit_logs
  for select using (public.is_platform_admin());

drop policy if exists ps_all on public.platform_settings;
create policy ps_all on public.platform_settings
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists ff_all on public.feature_flags;
create policy ff_all on public.feature_flags
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists pj_read on public.platform_jobs;
create policy pj_read on public.platform_jobs
  for select using (public.is_platform_admin());

-- ───────────────────────── Audit helper ─────────────────────────
create or replace function public.fn_platform_audit(
  p_action text, p_target_type text, p_target_id uuid, p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.platform_audit_logs(actor_id, action, target_type, target_id, detail)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end; $$;

-- ───────────────────────── Dashboard analytics ─────────────────────────
create or replace function public.admin_platform_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'tenants_total',     (select count(*) from public.tenants where deleted_at is null),
    'tenants_active',    (select count(*) from public.tenants where deleted_at is null and status = 'active'),
    'tenants_suspended', (select count(*) from public.tenants where deleted_at is null and status = 'suspended'),
    'users_total',       (select count(*) from public.profiles),
    'leads_total',       (select count(*) from public.leads    where deleted_at is null),
    'contacts_total',    (select count(*) from public.contacts where deleted_at is null),
    'deals_total',       (select count(*) from public.deals    where deleted_at is null),
    'signups_7d',        (select count(*) from public.tenants where created_at > now() - interval '7 days'),
    'signups_30d',       (select count(*) from public.tenants where created_at > now() - interval '30 days'),
    'recent_tenants',    (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
        select id, name, slug, status, created_at
        from public.tenants where deleted_at is null
        order by created_at desc limit 6
      ) t)
  ) into v;
  return v;
end; $$;

-- ───────────────────────── Tenant management ─────────────────────────
drop function if exists public.admin_list_tenants();
create or replace function public.admin_list_tenants(p_search text default null, p_status text default null)
returns table (
  id uuid, name text, slug text, status text, plan_tier text, created_at timestamptz,
  users bigint, leads bigint, contacts bigint, deals bigint, last_activity timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  return query
    select t.id, t.name, t.slug, t.status, t.plan_tier, t.created_at,
      (select count(*) from public.profiles p where p.tenant_id = t.id),
      (select count(*) from public.leads l    where l.tenant_id = t.id and l.deleted_at is null),
      (select count(*) from public.contacts c where c.tenant_id = t.id and c.deleted_at is null),
      (select count(*) from public.deals d    where d.tenant_id = t.id and d.deleted_at is null),
      (select max(a.created_at) from public.audit_logs a where a.tenant_id = t.id)
    from public.tenants t
    where t.deleted_at is null
      and (p_status is null or p_status = '' or t.status = p_status)
      and (p_search is null or p_search = ''
           or t.name ilike '%' || p_search || '%'
           or t.slug ilike '%' || p_search || '%')
    order by t.created_at desc;
end; $$;

create or replace function public.admin_tenant_detail(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status, 'plan_tier', t.plan_tier,
    'currency', t.currency, 'timezone', t.timezone, 'locale', t.locale, 'created_at', t.created_at,
    'users',      (select count(*) from public.profiles p where p.tenant_id = t.id),
    'leads',      (select count(*) from public.leads l    where l.tenant_id = t.id and l.deleted_at is null),
    'contacts',   (select count(*) from public.contacts c where c.tenant_id = t.id and c.deleted_at is null),
    'deals',      (select count(*) from public.deals d    where d.tenant_id = t.id and d.deleted_at is null),
    'tasks',      (select count(*) from public.tasks k    where k.tenant_id = t.id and k.deleted_at is null),
    'quotations', (select count(*) from public.quotations q where q.tenant_id = t.id and q.deleted_at is null),
    'last_activity', (select max(a.created_at) from public.audit_logs a where a.tenant_id = t.id),
    'integrations', (select coalesce(jsonb_agg(jsonb_build_object('channel', i.channel, 'enabled', i.is_enabled)), '[]'::jsonb)
                     from public.integration_settings i where i.tenant_id = t.id),
    'admins', (select coalesce(jsonb_agg(distinct pr.email), '[]'::jsonb)
               from public.profiles pr
               join public.user_roles ur on ur.user_id = pr.id
               join public.roles r on r.id = ur.role_id
               where pr.tenant_id = t.id and r.name = 'Admin')
  ) into v
  from public.tenants t
  where t.id = p_tenant and t.deleted_at is null;
  return v;
end; $$;

create or replace function public.admin_set_tenant_status(p_tenant uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_status not in ('active','suspended') then raise exception 'Invalid status: %', p_status; end if;
  update public.tenants set status = p_status where id = p_tenant and deleted_at is null;
  perform public.fn_platform_audit(
    case when p_status = 'suspended' then 'tenant.suspend' else 'tenant.reactivate' end,
    'tenant', p_tenant, jsonb_build_object('status', p_status));
end; $$;

-- Provisions a brand-new tenant for an already-created auth user (the server action
-- creates the user via the service role, then calls this). Mirrors signup_organization().
create or replace function public.admin_provision_tenant(
  p_owner uuid, p_name text,
  p_currency text default 'INR', p_timezone text default 'Asia/Kolkata', p_locale text default 'en'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_admin uuid; v_mgr uuid; v_rep uuid; v_pipeline uuid; v_slug text;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  if p_owner is null then raise exception 'Owner user is required'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Organization name is required'; end if;
  if exists (select 1 from public.profiles where id = p_owner) then
    raise exception 'That user already belongs to an organization';
  end if;

  v_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  insert into public.tenants(name, slug, currency, timezone, locale)
    values (p_name, v_slug, p_currency, p_timezone, p_locale) returning id into v_tenant;
  insert into public.profiles(id, tenant_id, email)
    values (p_owner, v_tenant, (select email from auth.users where id = p_owner));

  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Admin', 'Full access', true) returning id into v_admin;
  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Manager', 'Manages the team and all records', true) returning id into v_mgr;
  insert into public.roles(tenant_id, name, description, is_system) values
    (v_tenant, 'Sales Rep', 'Works own leads and deals', true) returning id into v_rep;

  insert into public.user_roles(tenant_id, user_id, role_id) values (v_tenant, p_owner, v_admin);
  insert into public.role_permissions(tenant_id, role_id, permission_id)
    select v_tenant, v_admin, pm.id from public.permissions pm;

  insert into public.pipelines(tenant_id, name, is_default, display_order)
    values (v_tenant, 'Sales Pipeline', true, 0) returning id into v_pipeline;
  insert into public.stages(tenant_id, pipeline_id, name, display_order, probability, is_won, is_lost) values
    (v_tenant, v_pipeline, 'New',         0, 10,  false, false),
    (v_tenant, v_pipeline, 'Contacted',   1, 25,  false, false),
    (v_tenant, v_pipeline, 'Qualified',   2, 50,  false, false),
    (v_tenant, v_pipeline, 'Negotiation', 3, 75,  false, false),
    (v_tenant, v_pipeline, 'Won',         4, 100, true,  false),
    (v_tenant, v_pipeline, 'Lost',        5, 0,   false, true);

  perform public.fn_platform_audit('tenant.provision', 'tenant', v_tenant,
    jsonb_build_object('name', p_name, 'owner', p_owner));
  return v_tenant;
end; $$;

-- ───────────────────────── Monitoring ─────────────────────────
create or replace function public.admin_monitoring()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  select jsonb_build_object(
    'db_ok', true,
    'integrations', jsonb_build_object(
       'email_enabled',    (select count(*) from public.integration_settings where channel = 'email'    and is_enabled),
       'whatsapp_enabled', (select count(*) from public.integration_settings where channel = 'whatsapp' and is_enabled)
    ),
    'jobs', jsonb_build_object(
       'queued',  (select count(*) from public.platform_jobs where status = 'queued'),
       'running', (select count(*) from public.platform_jobs where status = 'running'),
       'failed',  (select count(*) from public.platform_jobs where status = 'failed')
    ),
    'recent_jobs', (select coalesce(jsonb_agg(j), '[]'::jsonb) from (
        select id, kind, status, error, created_at, finished_at
        from public.platform_jobs order by created_at desc limit 10) j),
    'tenant_health', (select coalesce(jsonb_agg(h), '[]'::jsonb) from (
        select t.id, t.name, t.status,
          (select max(a.created_at) from public.audit_logs a where a.tenant_id = t.id) as last_activity,
          (select count(*) from public.profiles p where p.tenant_id = t.id) as users
        from public.tenants t where t.deleted_at is null
        order by last_activity desc nulls last limit 100) h)
  ) into v;
  return v;
end; $$;

create or replace function public.admin_recent_activity(p_limit int default 25)
returns table (id bigint, actor_email text, action text, target_type text, target_id uuid, detail jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  return query
    select l.id, (select u.email from auth.users u where u.id = l.actor_id),
           l.action, l.target_type, l.target_id, l.detail, l.created_at
    from public.platform_audit_logs l
    order by l.created_at desc limit greatest(1, least(p_limit, 200));
end; $$;

-- ───────────────────────── Settings & feature flags ─────────────────────────
create or replace function public.admin_platform_settings_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  select value into v from public.platform_settings where key = 'config';
  return coalesce(v, '{}'::jsonb);
end; $$;

create or replace function public.admin_platform_settings_set(p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  insert into public.platform_settings(key, value, updated_by)
    values ('config', coalesce(p_value, '{}'::jsonb), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.fn_platform_audit('settings.update', 'platform', null, coalesce(p_value, '{}'::jsonb));
end; $$;

create or replace function public.admin_list_feature_flags()
returns setof public.feature_flags language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  return query select * from public.feature_flags order by key;
end; $$;

create or replace function public.admin_upsert_feature_flag(
  p_key text, p_label text, p_description text, p_enabled boolean
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not authorized'; end if;
  if coalesce(trim(p_key),'') = '' then raise exception 'Flag key is required'; end if;
  insert into public.feature_flags(key, label, description, enabled)
    values (p_key, coalesce(nullif(trim(p_label),''), p_key), p_description, coalesce(p_enabled, false))
    on conflict (key) do update
      set label = excluded.label, description = excluded.description,
          enabled = excluded.enabled, updated_at = now();
  perform public.fn_platform_audit('feature_flag.update', 'feature_flag', null,
    jsonb_build_object('key', p_key, 'enabled', p_enabled));
end; $$;

-- ───────────────────────── Grants ─────────────────────────
grant execute on function public.admin_platform_overview()                       to authenticated;
grant execute on function public.admin_list_tenants(text, text)                  to authenticated;
grant execute on function public.admin_tenant_detail(uuid)                       to authenticated;
grant execute on function public.admin_set_tenant_status(uuid, text)             to authenticated;
grant execute on function public.admin_provision_tenant(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_monitoring()                              to authenticated;
grant execute on function public.admin_recent_activity(int)                      to authenticated;
grant execute on function public.admin_platform_settings_get()                   to authenticated;
grant execute on function public.admin_platform_settings_set(jsonb)              to authenticated;
grant execute on function public.admin_list_feature_flags()                      to authenticated;
grant execute on function public.admin_upsert_feature_flag(text, text, text, boolean) to authenticated;

-- ───────────────────────── Seed defaults ─────────────────────────
insert into public.platform_settings(key, value) values
  ('config', jsonb_build_object(
     'default_currency', 'INR', 'default_timezone', 'Asia/Kolkata', 'default_locale', 'en',
     'signups_enabled', true, 'maintenance_mode', false, 'support_email', ''))
on conflict (key) do nothing;

insert into public.feature_flags(key, label, description, enabled) values
  ('billing',      'Billing & Subscriptions', 'Plans, invoices and usage limits.',          false),
  ('ai_assistant', 'AI Assistant',            'Natural-language search, drafting, scoring.', false),
  ('customer_portal','Customer Portal',       'Client-facing quote acceptance portal.',      false)
on conflict (key) do nothing;
