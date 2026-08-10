-- 0039 Notification Email Digest
-- Closes the gap flagged in the build audit: notification_preferences.email (0017) was
-- stored and shown as a UI toggle intent, but nothing ever read it or sent an email.
--
-- Design: rather than a separate outbox/queue table, we mark each `notifications` row
-- with whether it still needs an email decision. A daily batch (folded into the existing
-- /api/workflows/tick cron — see route.ts — since Vercel's free-tier cron only runs
-- daily) groups any 'pending' rows per user, checks their per-type email preference,
-- and sends ONE digest email per user rather than one email per event (a daily digest
-- is also the better UX call regardless of the cron cadence — nobody wants a CRM
-- emailing them every time a task is assigned).
-- Run after 0001-0038. Idempotent.

alter table public.notifications
  add column if not exists email_status text not null default 'pending'
    check (email_status in ('pending','sent','skipped')),
  add column if not exists email_sent_at timestamptz;

-- Partial index: the digest query only ever scans undecided rows.
create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where email_status = 'pending';
