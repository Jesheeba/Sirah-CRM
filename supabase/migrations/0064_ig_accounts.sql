-- 0064 Instagram Login accounts (MLA social desk, feature F1).
-- Run after 0063. Idempotent.
--
-- An Instagram professional account connected through "Instagram API with Instagram Login"
-- (no Facebook Page). Separate from meta_lead_pages, which is keyed on a Page id and used by
-- the Facebook-Login flows. Same security model as 0023: the access token is a SECRET, so
-- client roles get column grants for the non-secret columns only; the token is read and
-- written only by the server-only service-role client.

create table if not exists public.ig_accounts (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  -- Instagram professional account id (the webhook `entry.id`). One account belongs to ONE tenant.
  ig_user_id         text not null unique,
  username           text,
  account_type       text,                           -- BUSINESS | MEDIA_CREATOR
  -- SECRET: long-lived (60-day) Instagram User access token. Service-role only.
  access_token       text not null,
  token_expires_at   timestamptz,
  scopes             text,
  status             text not null default 'active' check (status in ('active','expired','revoked')),
  webhook_subscribed boolean not null default false,
  connected_by       uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists ig_accounts_tenant_idx on public.ig_accounts (tenant_id);
create index if not exists ig_accounts_expiry_idx on public.ig_accounts (token_expires_at) where status = 'active';

drop trigger if exists set_updated_at on public.ig_accounts;
create trigger set_updated_at before update on public.ig_accounts
  for each row execute function public.set_updated_at();

alter table public.ig_accounts enable row level security;

drop policy if exists iga_read on public.ig_accounts;
create policy iga_read on public.ig_accounts
  for select using (tenant_id = public.current_tenant_id());

revoke all on public.ig_accounts from anon;
revoke all on public.ig_accounts from authenticated;

grant select (
  id, tenant_id, ig_user_id, username, account_type, token_expires_at, scopes,
  status, webhook_subscribed, connected_by, created_at, updated_at
) on public.ig_accounts to authenticated;

grant all on public.ig_accounts to service_role;
