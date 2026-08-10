-- 0048 Activities — structured call fields
-- Call direction/outcome/duration were already captured by the UI (RecordTimeline's
-- "Log call" tab), but only as a pipe-delimited encoding crammed into `activities.subject`
-- ("outbound|answered|5|discussed pricing") — invisible to reports/filters. This adds
-- real columns and backfills existing call rows from that encoding, then the app code
-- switches to writing/reading the columns directly (subject reset to a clean "Call").
-- Run after 0001-0047. Idempotent (guards re-parsing already-migrated rows).

alter table public.activities
  add column if not exists duration_minutes int,
  add column if not exists outcome text,
  add column if not exists direction text;

alter table public.activities
  drop constraint if exists activities_outcome_check;
alter table public.activities
  add constraint activities_outcome_check
    check (outcome is null or outcome in ('answered','no_answer','busy','left_voicemail'));

alter table public.activities
  drop constraint if exists activities_direction_check;
alter table public.activities
  add constraint activities_direction_check
    check (direction is null or direction in ('inbound','outbound'));

-- Backfill from the old "direction|outcome|duration|notes" subject encoding.
update public.activities
   set direction         = nullif(split_part(subject, '|', 1), ''),
       outcome            = nullif(split_part(subject, '|', 2), ''),
       duration_minutes   = case when split_part(subject, '|', 3) ~ '^[0-9]+$'
                                  then split_part(subject, '|', 3)::int end,
       description        = coalesce(nullif(description, ''), nullif(split_part(subject, '|', 4), '')),
       subject            = 'Call'
 where type = 'call'
   and subject like '%|%|%|%'
   and direction is null; -- idempotency guard
