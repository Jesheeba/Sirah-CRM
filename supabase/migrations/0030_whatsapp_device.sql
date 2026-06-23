-- Adds 'whatsapp_device' as a new integration channel for unofficial device-based
-- WhatsApp providers (UltraMsg-compatible REST APIs).
--
-- Column additions to integration_settings:
--   api_endpoint  — provider base URL (e.g. https://api.ultramsg.com). NOT a secret.
--   webhook_token — random UUID used to authenticate the provider's inbound webhook POSTs.
--                   SECRET: readable by service-role only, same security as access_token.

-- 1. Widen the channel CHECK constraint
ALTER TABLE public.integration_settings
  DROP CONSTRAINT IF EXISTS integration_settings_channel_check;

ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms', 'whatsapp_device'));

-- 2. New columns
ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS api_endpoint   text,
  ADD COLUMN IF NOT EXISTS webhook_token  uuid NOT NULL DEFAULT gen_random_uuid();

-- 3. Column-level grants
--    api_endpoint: readable by authenticated (it's the provider base URL, not a secret)
GRANT SELECT (api_endpoint) ON public.integration_settings TO authenticated;

--    webhook_token: intentionally NOT granted to anon or authenticated — only service_role.
--    (The existing REVOKE ALL … GRANT SELECT (non-secret cols) pattern from 0021 covers this.)
