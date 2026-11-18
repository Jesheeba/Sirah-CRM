-- 0067 Keyword rules for the Instagram social desk (MLA desk F9).
-- Run after 0066. Idempotent.
--
-- A rule matches an incoming comment / mention / DM by keywords (or always) and prepares a
-- reply: posted automatically, or queued for approval. Safety settings live on
-- ig_desk_settings: a blocklist that always routes to a person, a kill switch and send caps.
-- Writes go through admin-only server actions (service role); members can read.

alter table public.ig_desk_settings
  add column if not exists blocklist       text[]  not null default '{}',
  add column if not exists auto_paused     boolean not null default false,
  add column if not exists auto_hourly_cap integer not null default 30 check (auto_hourly_cap between 0 and 1000),
  add column if not exists auto_daily_cap  integer not null default 200 check (auto_daily_cap between 0 and 10000);

create table if not exists public.ig_rules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- null = every connected account of the tenant
  ig_account_id  uuid references public.ig_accounts(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  applies_to     text not null check (applies_to in ('comment','mention','dm')),
  -- null = every post; set = only comments on that post
  ig_media_id    text,
  rule_type      text not null default 'keyword' check (rule_type in ('keyword','always')),
  match_keywords text[] not null default '{}',
  match_mode     text not null default 'any' check (match_mode in ('any','all')),
  whole_word     boolean not null default true,
  -- lower number = checked first
  priority       integer not null default 100,
  is_enabled     boolean not null default true,
  action         text not null check (action in ('public_reply','private_reply','both','dm_reply')),
  reply_text     text check (reply_text is null or char_length(reply_text) <= 2200),
  dm_text        text check (dm_text is null or char_length(dm_text) <= 1000),
  send_mode      text not null default 'needs_approval' check (send_mode in ('auto','needs_approval')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ig_rules_tenant_idx on public.ig_rules (tenant_id, applies_to, priority) where is_enabled;

drop trigger if exists set_updated_at on public.ig_rules;
create trigger set_updated_at before update on public.ig_rules
  for each row execute function public.set_updated_at();

alter table public.ig_rules enable row level security;
drop policy if exists igru_read on public.ig_rules;
create policy igru_read on public.ig_rules for select using (tenant_id = public.current_tenant_id());

revoke all on public.ig_rules from anon, authenticated;
grant select on public.ig_rules to authenticated;
grant all on public.ig_rules to service_role;

-- ig_replies.rule_id now points at a rule (kept if the rule is deleted).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ig_replies_rule_fk') then
    alter table public.ig_replies
      add constraint ig_replies_rule_fk foreign key (rule_id) references public.ig_rules(id) on delete set null;
  end if;
end $$;
