-- 0024 Organization Branding & White-Label.
-- Run after 0001-0023. One row per tenant holds all branding/white-label settings.
--
-- Security model: branding must be READABLE by every member of the tenant (so the
-- logo/colors/labels apply for all users) but WRITABLE only by Admins. This mirrors
-- the integration_settings policy split (0021). No secret columns, so default
-- column grants are fine.

-- 1. Table ------------------------------------------------------------------------
create table if not exists public.organization_branding (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,

  -- Level 1 — Company branding
  brand_name          text,          -- shown instead of "Sirah CRM" (falls back to tenants.name)
  logo_url            text,          -- sidebar / top nav / login
  favicon_url         text,          -- browser tab icon
  loader_logo_url     text,          -- logo shown while the app loads
  browser_title       text,          -- custom browser tab title

  -- Level 2 — Theme & appearance
  primary_color       text,          -- hex, drives the brand colour ramp
  secondary_color     text,          -- hex, reserved for accent usage
  sidebar_theme       text,          -- 'light' | 'dark' | 'auto' (reserved)
  navigation_style    text,          -- 'classic' | 'collapsed' | 'top' | 'hybrid' (reserved)
  border_radius       text,          -- 'square' | 'rounded' | 'modern' (reserved)
  density             text,          -- 'compact' | 'comfortable' | 'spacious' (reserved)
  font_family         text,          -- 'Inter' | 'Roboto' | 'Poppins' | 'Open Sans' (reserved)

  -- Level 3 — Login experience
  login_background_url text,
  welcome_message      text,
  company_description  text,

  -- Levels 4-9 — flexible JSON configuration
  dashboard_layout    jsonb not null default '{}'::jsonb,
  module_labels       jsonb not null default '{}'::jsonb,   -- { "leads": "Patients", ... }
  module_visibility   jsonb not null default '{}'::jsonb,   -- { "products": false, ... }
  status_labels       jsonb not null default '{}'::jsonb,
  pipeline_settings   jsonb not null default '{}'::jsonb,
  module_icons        jsonb not null default '{}'::jsonb,

  -- Levels 10-11 — outbound document branding
  email_settings      jsonb not null default '{}'::jsonb,
  pdf_settings        jsonb not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id)
);

create index if not exists organization_branding_tenant_idx
  on public.organization_branding (tenant_id);

-- 2. Triggers: reuse the tenant stamp (0006) + updated_at (0001) helpers. ----------
drop trigger if exists stamp_tenant on public.organization_branding;
create trigger stamp_tenant before insert on public.organization_branding
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.organization_branding;
create trigger set_updated_at before update on public.organization_branding
  for each row execute function public.set_updated_at();

-- 3. RLS: every member reads their tenant's branding; only Admins write. ------------
alter table public.organization_branding enable row level security;

drop policy if exists ob_read on public.organization_branding;
create policy ob_read on public.organization_branding
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists ob_admin_write on public.organization_branding;
create policy ob_admin_write on public.organization_branding
  for all
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());
