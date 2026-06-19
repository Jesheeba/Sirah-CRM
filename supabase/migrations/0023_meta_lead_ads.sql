-- 0023 Meta (Facebook/Instagram) Lead Ads integration.
-- Run after 0001-0022. Idempotent.
--
-- A tenant connects Facebook Page(s) via OAuth; Meta then POSTs `leadgen` webhook
-- events whenever someone submits an ad's instant form. The webhook maps the incoming
-- page_id -> tenant, fetches the answers from the Graph API, and inserts a lead.
--
-- Security model mirrors 0021_integration_settings: the Page Access Token is a SECRET.
-- RLS can't mask columns, so we use Postgres COLUMN-LEVEL privileges — revoke all from
-- the client roles, then grant back ONLY the non-secret columns. The token is written
-- and read exclusively by the server-only service-role client (src/lib/supabase/admin.ts).

-- 1. Connected Pages --------------------------------------------------------------
create table if not exists public.meta_lead_pages (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- A Facebook Page belongs to exactly ONE tenant; this is the webhook lookup key.
  page_id          text not null unique,
  page_name        text,
  -- SECRET: long-lived Page Access Token (revoked from client roles; service-role only).
  access_token     text not null,
  is_enabled       boolean not null default true,
  subscribed       boolean not null default false,  -- subscribed to the leadgen webhook field
  -- Route this page's incoming leads to a specific user (nullable = unassigned).
  default_owner_id uuid references public.profiles(id) on delete set null,
  connected_by     uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists meta_lead_pages_tenant_idx on public.meta_lead_pages (tenant_id);

drop trigger if exists set_updated_at on public.meta_lead_pages;
create trigger set_updated_at before update on public.meta_lead_pages
  for each row execute function public.set_updated_at();

-- 2. Received-lead events (idempotency + audit) -----------------------------------
create table if not exists public.meta_lead_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references public.tenants(id) on delete cascade,
  -- Meta's leadgen id — UNIQUE so retried webhook deliveries never double-create a lead.
  leadgen_id  text not null unique,
  page_id     text,
  form_id     text,
  lead_id     uuid references public.leads(id) on delete set null,
  status      text not null default 'received'
              check (status in ('received','created','skipped','error')),
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists meta_lead_events_tenant_idx on public.meta_lead_events (tenant_id, created_at desc);

-- 3. RLS: members read their tenant's rows; ALL writes go through the service role. --
alter table public.meta_lead_pages  enable row level security;
alter table public.meta_lead_events enable row level security;

drop policy if exists mlp_read on public.meta_lead_pages;
create policy mlp_read on public.meta_lead_pages
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists mle_read on public.meta_lead_events;
create policy mle_read on public.meta_lead_events
  for select using (tenant_id = public.current_tenant_id());

-- 4. Column privileges: revoke everything from client roles, then grant back only the
--    non-secret columns. `access_token` is deliberately never granted to authenticated.
revoke all on public.meta_lead_pages  from anon;
revoke all on public.meta_lead_pages  from authenticated;
revoke all on public.meta_lead_events from anon;
revoke all on public.meta_lead_events from authenticated;

grant select (
  id, tenant_id, page_id, page_name, is_enabled, subscribed,
  default_owner_id, connected_by, created_at, updated_at
) on public.meta_lead_pages to authenticated;

-- meta_lead_events holds only metadata (no secrets) — safe to read whole, RLS-scoped.
grant select on public.meta_lead_events to authenticated;

grant all on public.meta_lead_pages  to service_role;
grant all on public.meta_lead_events to service_role;
