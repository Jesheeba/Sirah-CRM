-- 0061 Hardened pull-feed credentials: several named, revocable API keys per tenant.
-- Run after 0060. Idempotent. Supersedes the single plaintext token in tenant_lead_feeds.
--
--  * Only a SHA-256 hash of each key is stored. The plaintext key is shown once, at
--    creation, and can never be read back (not even by a Super Admin or from the DB).
--  * Each key has a name, last-used time and its own revoke switch, so one leaked
--    consumer can be cut off without touching the others.
--  * lead_feed_hit() is an atomic per-key, per-minute rate limiter that also records
--    last use. Service-role only, like the tables.
--
-- tenant_lead_feeds is NOT dropped here: the previous deploy still reads it. Existing
-- links are copied across (hashed), so they keep working. Drop it in 0062 once the new
-- code is live.

create table if not exists public.lead_feed_keys (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  key_prefix    text not null,                 -- first chars, for recognising a key in the UI
  key_hash      text not null unique,          -- hex SHA-256 of the full key
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  last_used_via text check (last_used_via in ('header', 'url')),
  revoked_at    timestamptz
);
create index if not exists lead_feed_keys_tenant_idx on public.lead_feed_keys (tenant_id, created_at desc);

create table if not exists public.lead_feed_rate (
  key_id uuid not null references public.lead_feed_keys(id) on delete cascade,
  bucket timestamptz not null,                 -- start of the minute
  hits   integer not null default 0,
  primary key (key_id, bucket)
);

alter table public.lead_feed_keys enable row level security;
alter table public.lead_feed_rate enable row level security;

revoke all on public.lead_feed_keys from anon, authenticated;
revoke all on public.lead_feed_rate from anon, authenticated;
grant all on public.lead_feed_keys to service_role;
grant all on public.lead_feed_rate to service_role;

-- Count one request for a key; true = allowed, false = over the per-minute limit.
create or replace function public.lead_feed_hit(p_key uuid, p_limit integer, p_via text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  insert into public.lead_feed_rate (key_id, bucket, hits)
  values (p_key, date_trunc('minute', now()), 1)
  on conflict (key_id, bucket) do update set hits = public.lead_feed_rate.hits + 1
  returning hits into v_hits;

  -- Keep the table small.
  delete from public.lead_feed_rate where bucket < now() - interval '1 hour';

  -- Record last use, at most once a minute per key to avoid a write on every request.
  update public.lead_feed_keys
     set last_used_at = now(), last_used_via = p_via
   where id = p_key and (last_used_at is null or last_used_at < now() - interval '1 minute');

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.lead_feed_hit(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.lead_feed_hit(uuid, integer, text) to service_role;

-- Carry existing links over so nobody's current integration breaks. Hashed here, so the
-- plaintext token is no longer needed after the old table is dropped in 0062.
do $$
begin
  if to_regclass('public.tenant_lead_feeds') is not null then
    insert into public.lead_feed_keys (tenant_id, name, key_prefix, key_hash, created_at)
    select tenant_id, 'Original link', left(token, 8),
           encode(sha256(convert_to(token, 'UTF8')), 'hex'), created_at
      from public.tenant_lead_feeds
    on conflict (key_hash) do nothing;
  end if;
end $$;
