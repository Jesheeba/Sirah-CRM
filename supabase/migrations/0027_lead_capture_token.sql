-- Public lead-capture token: unique per tenant, used as the secret for
-- POST /api/leads/capture?token=... so landing pages can submit leads directly.
-- Admins can regenerate at any time from Settings → Integrations.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lead_capture_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS tenants_lead_capture_token_key
  ON tenants (lead_capture_token);
