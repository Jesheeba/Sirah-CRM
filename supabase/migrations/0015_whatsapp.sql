-- 0015 WhatsApp (Phase 7): reuses the channel-aware `communications` log and
-- `email_templates` (channel='whatsapp') from Phase 6. Only additive bits are needed:
--   1) a recipient phone column on communications,
--   2) a status-update function for delivery/read receipts (Cloud API webhook).
-- Run after 0001-0014. Idempotent.

alter table public.communications add column if not exists to_phone text;

-- Updates a message's status by the provider's message id. Called by the public
-- WhatsApp webhook (logged-out), so it's SECURITY DEFINER and bypasses RLS.
create or replace function public.fn_comm_update_status(p_msg_id text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.communications
     set status    = p_status,
         opened_at = case when p_status = 'opened' then coalesce(opened_at, now()) else opened_at end
   where provider_message_id = p_msg_id;
end; $$;
grant execute on function public.fn_comm_update_status(text, text) to anon, authenticated;
