-- 0047 Unified Conversation Inbox
-- `communications` (0014) already stores both email and WhatsApp with a common shape —
-- it just wasn't surfaced anywhere as a merged per-contact thread (RecordTimeline, the
-- generic notes/activities/tasks feed, never included it). This adds only what's
-- actually missing: unread state. Default TRUE (not "unread") because most insert paths
-- are things the acting rep already saw (they just sent it, or manually logged it) —
-- only the two WhatsApp inbound webhooks explicitly set it FALSE for a genuinely new
-- incoming message (see route.ts changes alongside this migration).
-- Run after 0001-0046. Idempotent.

alter table public.communications
  add column if not exists is_read boolean not null default true;

create index if not exists communications_unread_idx
  on public.communications (related_to_type, related_to_id)
  where is_read = false;
