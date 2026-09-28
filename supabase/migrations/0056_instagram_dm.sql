-- 0056 Instagram DM automation.
-- Run after 0001-0055. Idempotent.
--
-- Reuses the existing Meta OAuth grant (meta_lead_pages) and the channel-aware
-- `communications` log (0014, extended for WhatsApp in 0015) rather than building a
-- parallel messaging system. Adds only what's genuinely new: which connected Page has
-- Instagram DM automation turned on, and a small per-conversation state machine
-- (bot/human mode + automation rules) since nothing like that exists anywhere yet —
-- the generic `workflows` engine (0009/0033) is cron-driven and too slow for a chat
-- reply that needs to feel instant.

-- 1. Extend meta_lead_pages with Instagram linkage -------------------------------
alter table public.meta_lead_pages
  add column if not exists ig_business_id text,
  add column if not exists ig_dm_enabled boolean not null default false;

grant select (ig_business_id, ig_dm_enabled) on public.meta_lead_pages to authenticated;

-- 2. Extend communications for a non-phone/email recipient identifier ------------
alter table public.communications
  add column if not exists to_external_id text;

alter table public.communications drop constraint if exists communications_channel_check;
alter table public.communications
  add constraint communications_channel_check check (channel in ('email','whatsapp','sms','instagram'));

-- 3. Extend contacts so an inbound DM can auto-create/match a contact ------------
alter table public.contacts
  add column if not exists instagram_id text,
  add column if not exists source text;
create index if not exists contacts_instagram_id_idx on public.contacts (tenant_id, instagram_id) where instagram_id is not null;

-- 4. Automation rules --------------------------------------------------------------
create table if not exists public.instagram_automation_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  page_id          text not null references public.meta_lead_pages(page_id) on delete cascade,
  rule_type        text not null check (rule_type in ('keyword','menu','ai_fallback','handoff')),
  priority         integer not null default 100,
  is_enabled       boolean not null default true,
  -- keyword/handoff: case-insensitive substring match against inbound text.
  match_keywords   text[] not null default '{}',
  -- menu/handoff/keyword: the reply sent when this rule fires.
  reply_text       text,
  -- menu: [{ "title": "...", "payload": "..." }] sent as Instagram quick replies.
  reply_buttons    jsonb,
  -- menu/handoff: matched against message.quick_reply.payload (exact match).
  payload          text,
  -- ai_fallback: system prompt used to draft the reply.
  ai_system_prompt text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ig_rules_tenant_page_idx on public.instagram_automation_rules (tenant_id, page_id, priority);

drop trigger if exists set_updated_at on public.instagram_automation_rules;
create trigger set_updated_at before update on public.instagram_automation_rules
  for each row execute function public.set_updated_at();

-- 5. Per-conversation state (bot/human mode + AI rate-limit bookkeeping) ---------
create table if not exists public.instagram_conversations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  page_id         text not null references public.meta_lead_pages(page_id) on delete cascade,
  ig_user_id      text not null,
  contact_id      uuid references public.contacts(id) on delete set null,
  mode            text not null default 'bot' check (mode in ('bot','human')),
  last_inbound_at timestamptz,
  last_ai_reply_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, page_id, ig_user_id)
);
create index if not exists ig_conversations_tenant_idx on public.instagram_conversations (tenant_id);

drop trigger if exists set_updated_at on public.instagram_conversations;
create trigger set_updated_at before update on public.instagram_conversations
  for each row execute function public.set_updated_at();

-- 6. RLS: members read their tenant's rows; all writes go through the service role. --
alter table public.instagram_automation_rules enable row level security;
alter table public.instagram_conversations    enable row level security;

drop policy if exists igr_read on public.instagram_automation_rules;
create policy igr_read on public.instagram_automation_rules
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists igc_read on public.instagram_conversations;
create policy igc_read on public.instagram_conversations
  for select using (tenant_id = public.current_tenant_id());

revoke all on public.instagram_automation_rules from anon;
revoke all on public.instagram_automation_rules from authenticated;
revoke all on public.instagram_conversations    from anon;
revoke all on public.instagram_conversations    from authenticated;

grant select on public.instagram_automation_rules to authenticated;
grant select on public.instagram_conversations    to authenticated;

grant all on public.instagram_automation_rules to service_role;
grant all on public.instagram_conversations    to service_role;

-- 7. Audit trail, consistent with other tenant-scoped tables. -------------------
drop trigger if exists audit_instagram_automation_rules on public.instagram_automation_rules;
create trigger audit_instagram_automation_rules after insert or update or delete on public.instagram_automation_rules
  for each row execute function public.fn_audit();
drop trigger if exists audit_instagram_conversations on public.instagram_conversations;
create trigger audit_instagram_conversations after insert or update or delete on public.instagram_conversations
  for each row execute function public.fn_audit();
