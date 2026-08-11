-- 0052 Add `communications` to the Realtime publication.
-- Same pattern as 0017 (notifications): needed so the WhatsApp inbox and per-contact
-- conversation thread can subscribe to live inbound messages instead of only showing
-- what was present at page load. RLS (comm_read, 0014) still applies — Realtime only
-- broadcasts a row change to clients whose session can actually read that row, so this
-- does not widen access, only lets already-visible rows arrive live.
-- Run after 0001-0051. Idempotent.

do $$ begin
  alter publication supabase_realtime add table public.communications;
exception
  when duplicate_object then null;   -- already in the publication
  when undefined_object then null;   -- publication not present in this project
end $$;
