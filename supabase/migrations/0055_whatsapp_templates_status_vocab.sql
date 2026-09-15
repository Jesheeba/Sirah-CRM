-- 0055 WhatsApp templates: widen status vocabulary to match Meta's full lifecycle.
--
-- The message_template_status_update webhook can also send IN_APPEAL, PENDING_DELETION,
-- FLAGGED, and REINSTATED (0053's handler already named these in a comment as "known but
-- unhandled"). They weren't in the CHECK constraint or the webhook's event whitelist, so
-- those transitions were silently dropped (app-level guard short-circuits before the
-- UPDATE) instead of being reflected on the row — a template stuck in appeal or queued
-- for deletion never changes status in the CRM. Widen the constraint so the webhook can
-- write the full vocabulary Meta actually sends.
--
-- Run after 0001-0054. Idempotent.

ALTER TABLE public.whatsapp_templates DROP CONSTRAINT IF EXISTS whatsapp_templates_status_check;

ALTER TABLE public.whatsapp_templates
  ADD CONSTRAINT whatsapp_templates_status_check
  CHECK (status IN (
    'DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED',
    'IN_APPEAL', 'PENDING_DELETION', 'FLAGGED', 'REINSTATED'
  ));
