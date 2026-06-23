-- 0031 WhatsApp Cloud API inbound: adds secret columns for per-tenant webhook authentication.
--   app_secret    — Meta App Secret for HMAC-SHA256 verification of inbound webhook payloads
--   verify_token  — admin-set string for the GET hub.verify_token handshake
--   app_secret_set — non-secret boolean hint shown in Settings UI
--
-- Follows the column-level secret security pattern from 0021 / 0030:
-- secrets are never granted to anon or authenticated; only service_role reads them.
-- Run after 0001-0030. Idempotent.

ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS app_secret     text,
  ADD COLUMN IF NOT EXISTS verify_token   text,
  ADD COLUMN IF NOT EXISTS app_secret_set boolean NOT NULL DEFAULT false;

-- Allow authenticated to see the status hint only
GRANT SELECT (app_secret_set) ON public.integration_settings TO authenticated;
-- app_secret and verify_token intentionally NOT granted to anon or authenticated (service-role only).
-- The existing REVOKE ALL … GRANT SELECT (named columns) pattern from 0021 covers this:
-- new columns are never auto-leaked because the original REVOKE ALL already removed the
-- default table-level SELECT privilege, and only explicitly listed columns were re-granted.
