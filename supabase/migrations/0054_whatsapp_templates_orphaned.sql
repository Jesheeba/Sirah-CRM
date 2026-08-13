-- 0054 WhatsApp templates: mark local rows Meta no longer knows about.
--
-- Sync (GET /{waba_id}/message_templates) reconciles our local rows against Meta's
-- list. A row that WAS submitted (has a meta_template_id) but no longer appears on
-- Meta was deleted there outside our app (e.g. manually in WhatsApp Manager) — we
-- must not silently delete the local row for that (a client's history shouldn't
-- vanish), so mark it instead. DRAFT rows are never compared against Meta's list in
-- the first place (they were never submitted), so this column is meaningless for them.
--
-- Run after 0001-0053. Idempotent.

ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS orphaned_at timestamptz;

-- Non-secret status hint — same column-grant pattern as the rest of this table: only
-- the service-role sync/webhook code sets it, tenants can read it.
GRANT SELECT (orphaned_at) ON public.whatsapp_templates TO authenticated;
