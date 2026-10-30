-- 0060 Per-tenant pull feed of Meta (Facebook/Instagram) Lead Ads leads.
-- Run after 0001-0059. Idempotent.
--
-- The Super Admin generates a private feed link for a client; an external CRM, Excel
-- (Power Query) or Google Sheets then PULLS that tenant's Meta leads from
-- GET /api/export/facebook-leads?token=... (the token is the only credential).
--
-- The token is a SECRET that grants read access to lead data, so it lives in its own
-- table instead of a `tenants` column: tenant members can SELECT their own tenant row,
-- and RLS can't hide a single column. RLS is enabled with NO policies and every client
-- role is revoked — only the server-only service-role client reads or writes it.

create table if not exists public.tenant_lead_feeds (
  tenant_id  uuid primary key references public.tenants(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

alter table public.tenant_lead_feeds enable row level security;

revoke all on public.tenant_lead_feeds from anon;
revoke all on public.tenant_lead_feeds from authenticated;
grant all on public.tenant_lead_feeds to service_role;
