-- 0065 Instagram interactions inbox store (MLA social desk, feature F2).
-- Run after 0064. Idempotent.
--
-- One row per inbound comment, @mention, tagged post or direct message on a connected
-- Instagram Login account. Inserted only by the server (service role) from the webhook and the
-- tag poller; members of the tenant can read. UNIQUE (ig_account_id, provider_id) makes a
-- retried webhook delivery a no-op.

create table if not exists public.ig_interactions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  ig_account_id       uuid not null references public.ig_accounts(id) on delete cascade,
  kind                text not null check (kind in ('comment','mention','tag','dm')),
  -- Instagram's id for the thing itself: comment id, mention comment/media id, tagged media id, message mid.
  provider_id         text not null,
  author_id           text,
  author_handle       text,
  text                text,
  media_id            text,
  permalink           text,
  parent_id           text,                 -- set when the comment is a reply in a thread
  created_at_provider timestamptz,
  received_at         timestamptz not null default now(),
  status              text not null default 'new'
                      check (status in ('new','assigned','replied','ignored','issue','deleted')),
  assigned_to         uuid references public.profiles(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,
  -- Raw provider payload for support/debugging. Server-only: not granted to client roles.
  raw                 jsonb,
  unique (ig_account_id, provider_id)
);
create index if not exists ig_interactions_inbox_idx
  on public.ig_interactions (tenant_id, status, received_at desc);
create index if not exists ig_interactions_kind_idx
  on public.ig_interactions (tenant_id, kind, received_at desc);

alter table public.ig_interactions enable row level security;

drop policy if exists igi_read on public.ig_interactions;
create policy igi_read on public.ig_interactions
  for select using (tenant_id = public.current_tenant_id());

revoke all on public.ig_interactions from anon;
revoke all on public.ig_interactions from authenticated;

grant select (
  id, tenant_id, ig_account_id, kind, provider_id, author_id, author_handle, text,
  media_id, permalink, parent_id, created_at_provider, received_at, status, assigned_to, lead_id
) on public.ig_interactions to authenticated;

grant all on public.ig_interactions to service_role;
