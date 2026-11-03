-- 0062 Inbound lead webhook (contract v1): POST /api/v1/leads/webhook/<channel>.
-- Run after 0061. Idempotent.
--
-- An external system (e.g. RD Interlock Bricks' relay) signs each request with HMAC-SHA256
-- and posts form submissions. A "channel" is the path value that selects a tenant, its
-- signing secret and its routing. All of it is service-role only: the secret is an HMAC key
-- the server must hold in the clear to verify signatures, so — like the Meta page tokens in
-- 0023 — it sits in a table no client role can read (RLS on, no policies, grants revoked).

create table if not exists public.lead_webhook_channels (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- Fixed string in the URL path. Globally unique: it is the only thing that selects the tenant.
  channel           text not null unique check (channel ~ '^[a-z0-9][a-z0-9_-]{1,38}$'),
  name              text not null,
  secret            text not null,                      -- SECRET: HMAC signing key
  is_enabled        boolean not null default true,
  default_owner_id  uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  secret_rotated_at timestamptz not null default now(),
  last_used_at      timestamptz
);
create index if not exists lead_webhook_channels_tenant_idx on public.lead_webhook_channels (tenant_id);

-- One row per request: lets support trace a delivery by the requestId we hand back.
create table if not exists public.lead_webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.lead_webhook_channels(id) on delete cascade,
  request_id  text not null,
  http_status integer not null,
  error_code  text,
  received    integer not null default 0,
  created     integer not null default 0,
  updated     integer not null default 0,
  failed      integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists lead_webhook_deliveries_channel_idx
  on public.lead_webhook_deliveries (channel_id, created_at desc);

create table if not exists public.lead_webhook_rate (
  channel_id uuid not null references public.lead_webhook_channels(id) on delete cascade,
  bucket     timestamptz not null,
  hits       integer not null default 0,
  primary key (channel_id, bucket)
);

alter table public.lead_webhook_channels   enable row level security;
alter table public.lead_webhook_deliveries enable row level security;
alter table public.lead_webhook_rate       enable row level security;

revoke all on public.lead_webhook_channels   from anon, authenticated;
revoke all on public.lead_webhook_deliveries from anon, authenticated;
revoke all on public.lead_webhook_rate       from anon, authenticated;
grant all on public.lead_webhook_channels   to service_role;
grant all on public.lead_webhook_deliveries to service_role;
grant all on public.lead_webhook_rate       to service_role;

-- Count one request; true = allowed, false = over the per-minute limit. Also stamps
-- last_used_at (at most once a minute) and trims old log rows.
create or replace function public.lead_webhook_hit(p_channel uuid, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.lead_webhook_rate (channel_id, bucket, hits)
  values (p_channel, date_trunc('minute', now()), 1)
  on conflict (channel_id, bucket) do update set hits = public.lead_webhook_rate.hits + 1
  returning hits into v_hits;

  delete from public.lead_webhook_rate where bucket < now() - interval '1 hour';
  delete from public.lead_webhook_deliveries where created_at < now() - interval '30 days';

  update public.lead_webhook_channels
     set last_used_at = now()
   where id = p_channel and (last_used_at is null or last_used_at < now() - interval '1 minute');

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.lead_webhook_hit(uuid, integer) from public, anon, authenticated;
grant execute on function public.lead_webhook_hit(uuid, integer) to service_role;

-- Hard guarantee behind "re-delivering the same leadId updates, never duplicates": a
-- tenant can hold at most one live lead per Meta/relay lead id. This also covers a
-- submission arriving through both the direct Meta connection and the webhook.
create unique index if not exists leads_tenant_fb_leadgen_uniq
  on public.leads (tenant_id, (custom_fields ->> 'fb_leadgen_id'))
  where deleted_at is null and custom_fields ? 'fb_leadgen_id';
