-- 0066 Replies from the Instagram social desk, with approval + audit (MLA desk F4).
-- Run after 0065. Idempotent.
--
-- A reply is drafted by a person (later: by a keyword rule or AI), optionally approved, then
-- posted to Instagram. Writes go through server actions (service role) so the approval rules
-- live in one place; members of the tenant can read. ig_reply_events is the audit trail.

create table if not exists public.ig_desk_settings (
  tenant_id          uuid primary key references public.tenants(id) on delete cascade,
  -- human_approval: nothing posts until an Admin/Manager approves. direct: Admin/Manager posts at once.
  reply_mode         text not null default 'human_approval' check (reply_mode in ('human_approval','direct')),
  -- When false, the person who drafted a reply cannot approve it themselves.
  allow_self_approve boolean not null default false,
  updated_at         timestamptz not null default now()
);

create table if not exists public.ig_replies (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  interaction_id    uuid not null references public.ig_interactions(id) on delete cascade,
  channel           text not null check (channel in ('public','private','dm')),
  body              text not null check (char_length(body) between 1 and 2200),
  source            text not null default 'human' check (source in ('human','rule','ai')),
  rule_id           uuid,
  status            text not null default 'pending_approval'
                    check (status in ('pending_approval','approved','sent','rejected','failed')),
  drafted_by        uuid references public.profiles(id) on delete set null,
  approved_by       uuid references public.profiles(id) on delete set null,
  sent_at           timestamptz,
  provider_reply_id text,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists ig_replies_interaction_idx on public.ig_replies (interaction_id, created_at);
create index if not exists ig_replies_pending_idx on public.ig_replies (tenant_id, status) where status = 'pending_approval';

create table if not exists public.ig_reply_events (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  reply_id   uuid not null references public.ig_replies(id) on delete cascade,
  actor      uuid references public.profiles(id) on delete set null,
  action     text not null,   -- drafted | approved | sent | rejected | failed | retried
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists ig_reply_events_reply_idx on public.ig_reply_events (reply_id, created_at);

drop trigger if exists set_updated_at on public.ig_replies;
create trigger set_updated_at before update on public.ig_replies
  for each row execute function public.set_updated_at();

alter table public.ig_desk_settings enable row level security;
alter table public.ig_replies       enable row level security;
alter table public.ig_reply_events  enable row level security;

drop policy if exists igds_read on public.ig_desk_settings;
create policy igds_read on public.ig_desk_settings for select using (tenant_id = public.current_tenant_id());
drop policy if exists igr_read on public.ig_replies;
create policy igr_read on public.ig_replies for select using (tenant_id = public.current_tenant_id());
drop policy if exists igre_read on public.ig_reply_events;
create policy igre_read on public.ig_reply_events for select using (tenant_id = public.current_tenant_id());

revoke all on public.ig_desk_settings from anon, authenticated;
revoke all on public.ig_replies       from anon, authenticated;
revoke all on public.ig_reply_events  from anon, authenticated;
grant select on public.ig_desk_settings to authenticated;
grant select on public.ig_replies       to authenticated;
grant select on public.ig_reply_events  to authenticated;
grant all on public.ig_desk_settings, public.ig_replies, public.ig_reply_events to service_role;
