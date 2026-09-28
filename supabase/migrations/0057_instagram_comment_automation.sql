-- 0057 Instagram comment automation + general inbound DM auto-reply.
-- Run after 0001-0056. Idempotent.
--
-- Adds a comment-side counterpart to the DM automation from 0056: auto-reply to a
-- comment on a specific reel/post (or every post), and/or send the commenter a private
-- DM (Instagram's "private reply" API), keyed by the comment's media id so a rule can
-- be scoped to one reel. Reuses meta_lead_pages/instagram_conversations/contacts exactly
-- like the DM path — a comment-triggered DM becomes an ordinary tracked conversation.

-- 1. Extend meta_lead_pages with a comment-automation toggle -----------------------
alter table public.meta_lead_pages
  add column if not exists ig_comment_automation_enabled boolean not null default false;

grant select (ig_comment_automation_enabled) on public.meta_lead_pages to authenticated;

-- 2. Comment automation rules -------------------------------------------------------
create table if not exists public.instagram_comment_rules (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  page_id          text not null references public.meta_lead_pages(page_id) on delete cascade,
  -- null = applies to every post/reel on the page; set = scoped to one media id.
  ig_media_id      text,
  rule_type        text not null check (rule_type in ('keyword','always')),
  priority         integer not null default 100,
  is_enabled       boolean not null default true,
  -- keyword: case-insensitive substring match against the comment text. Ignored for 'always'.
  match_keywords   text[] not null default '{}',
  action_type      text not null check (action_type in ('comment_reply','private_reply','both')),
  -- comment_reply/both: posted as a public reply under the comment.
  reply_text       text,
  -- private_reply/both: sent as a DM to the commenter (Instagram's private-reply API).
  dm_text          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists ig_comment_rules_tenant_page_idx
  on public.instagram_comment_rules (tenant_id, page_id, ig_media_id, priority);

drop trigger if exists set_updated_at on public.instagram_comment_rules;
create trigger set_updated_at before update on public.instagram_comment_rules
  for each row execute function public.set_updated_at();

-- 3. Idempotency for processed comments ---------------------------------------------
-- Comment replies aren't `communications` rows (they're public Graph API replies, not
-- a channel message to a contact), so dedupe against a dedicated table instead of
-- reusing communications.provider_message_id like the DM webhook does.
create table if not exists public.instagram_processed_comments (
  comment_id text primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 4. Allow the new catch-all DM rule type introduced alongside this feature ---------
alter table public.instagram_automation_rules drop constraint if exists instagram_automation_rules_rule_type_check;
alter table public.instagram_automation_rules
  add constraint instagram_automation_rules_rule_type_check
  check (rule_type in ('keyword','menu','ai_fallback','handoff','always'));

-- 5. RLS: members read their tenant's rows; all writes go through the service role. --
alter table public.instagram_comment_rules       enable row level security;
alter table public.instagram_processed_comments  enable row level security;

drop policy if exists igcr_read on public.instagram_comment_rules;
create policy igcr_read on public.instagram_comment_rules
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists igpc_read on public.instagram_processed_comments;
create policy igpc_read on public.instagram_processed_comments
  for select using (tenant_id = public.current_tenant_id());

revoke all on public.instagram_comment_rules      from anon;
revoke all on public.instagram_comment_rules      from authenticated;
revoke all on public.instagram_processed_comments from anon;
revoke all on public.instagram_processed_comments from authenticated;

grant select on public.instagram_comment_rules      to authenticated;
grant select on public.instagram_processed_comments to authenticated;

grant all on public.instagram_comment_rules      to service_role;
grant all on public.instagram_processed_comments to service_role;

-- 6. Audit trail, consistent with other tenant-scoped tables. -----------------------
drop trigger if exists audit_instagram_comment_rules on public.instagram_comment_rules;
create trigger audit_instagram_comment_rules after insert or update or delete on public.instagram_comment_rules
  for each row execute function public.fn_audit();
