-- 0042 Email Click Tracking
-- The `communications.clicked_at` / status='clicked' plumbing has existed since 0014 —
-- only the capture endpoint and the RPC to write it were missing. No new table: reuses
-- the same open_token issued for the tracking pixel (see fn_email_track_open, 0014).
-- Run after 0001-0041. Idempotent.

-- A click is strong evidence of an open too (many mail clients block the open pixel's
-- remote image by default, but a click is a real user action that always reaches us) —
-- so this also backfills opened_at when it was never set.
create or replace function public.fn_email_track_click(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.communications
     set opened_at  = coalesce(opened_at, now()),
         clicked_at = coalesce(clicked_at, now()),
         status     = 'clicked'
   where open_token = p_token;
end; $$;

grant execute on function public.fn_email_track_click(uuid) to anon, authenticated;
