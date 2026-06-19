-- 0021 Per-tenant integration settings (Email / WhatsApp / SMS scaffold).
-- Run after 0001-0020. Each tenant configures its own provider credentials in-app
-- instead of sharing the deployment-wide env vars.
--
-- Security model: provider secrets (api_key / access_token) must be UNREADABLE and
-- UNWRITABLE from the browser (anon/authenticated). RLS cannot mask individual
-- columns, so we use Postgres COLUMN-LEVEL privileges: revoke everything from the
-- client roles, then grant back ONLY the non-secret columns. Secrets are written
-- exclusively via the server-only service-role client (see src/lib/supabase/admin.ts).

-- 1. Table ------------------------------------------------------------------------
create table if not exists public.integration_settings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  channel              text not null check (channel in ('email','whatsapp','sms')),
  is_enabled           boolean not null default false,
  -- non-secret config (readable by tenant members) --
  from_email           text,        -- email: verified sender address
  from_name            text,        -- email: display name
  phone_id             text,        -- whatsapp: Meta phone-number id (URL path param)
  business_account_id  text,        -- whatsapp: WABA id
  sms_sender_id        text,        -- sms scaffold: non-secret sender id
  -- secret columns (revoked from client roles; service-role only) --
  api_key              text,        -- email: Resend API key
  access_token         text,        -- whatsapp / sms: provider token
  -- non-secret status hint, written by the service-role action --
  secret_set           boolean not null default false,
  secret_last4         text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, channel)
);

create index if not exists integration_settings_tenant_idx
  on public.integration_settings (tenant_id, channel);

-- 2. Triggers: reuse the existing tenant stamp (0006) + updated_at (0001) helpers. --
drop trigger if exists stamp_tenant on public.integration_settings;
create trigger stamp_tenant before insert on public.integration_settings
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.integration_settings;
create trigger set_updated_at before update on public.integration_settings
  for each row execute function public.set_updated_at();

-- 3. RLS: members read their tenant's rows; only admins write (mirrors 0008). -------
alter table public.integration_settings enable row level security;

drop policy if exists is_read on public.integration_settings;
create policy is_read on public.integration_settings
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists is_admin_write on public.integration_settings;
create policy is_admin_write on public.integration_settings
  for all
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

-- 4. Column privileges: RLS can't hide columns. Supabase grants ALL on new public
--    tables to anon/authenticated by default, so revoke everything from the client
--    roles first, then grant back ONLY non-secret columns. New secret columns added
--    later therefore never auto-leak. service_role keeps full access (bypasses RLS).
revoke all on public.integration_settings from anon;
revoke all on public.integration_settings from authenticated;

grant select (
  id, tenant_id, channel, is_enabled,
  from_email, from_name, phone_id, business_account_id, sms_sender_id,
  secret_set, secret_last4, created_at, updated_at
) on public.integration_settings to authenticated;

-- Admins may edit non-secret config directly (RLS is_admin_write still gates rows);
-- secret columns are intentionally omitted so they can only be set via service role.
grant insert (
  tenant_id, channel, is_enabled,
  from_email, from_name, phone_id, business_account_id, sms_sender_id
) on public.integration_settings to authenticated;
grant update (
  is_enabled, from_email, from_name, phone_id, business_account_id, sms_sender_id
) on public.integration_settings to authenticated;
grant delete on public.integration_settings to authenticated;

grant all on public.integration_settings to service_role;

-- 5. Tighten the tenants policy: the original tenant_self (for all) let ANY member
--    edit the org row. Reads stay open to members; updates become admin-only.
--    Safe because provisioning runs through the security-definer signup_organization()
--    RPC (0004), not this policy.
drop policy if exists tenant_self on public.tenants;
create policy tenant_read on public.tenants
  for select using (id = public.current_tenant_id());
create policy tenant_admin_write on public.tenants
  for update using (id = public.current_tenant_id() and public.is_admin())
            with check (id = public.current_tenant_id() and public.is_admin());
