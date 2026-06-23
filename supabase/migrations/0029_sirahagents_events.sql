-- Audit + idempotency table for seller registrations pushed from sirahagents.com.
-- Security mirrors meta_lead_events: service-role writes only; authenticated can read own tenant rows.

CREATE TABLE IF NOT EXISTS public.sirahagents_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        REFERENCES public.tenants ON DELETE CASCADE,
  seller_id   text,                         -- sirahagents' own seller ID, if provided in payload
  email       text,                         -- denormalized for dedup index lookups
  status      text        NOT NULL DEFAULT 'received'
              CHECK (status IN ('received','created','deduped','invalid_token','error')),
  error       text,
  lead_id     uuid        REFERENCES public.leads ON DELETE SET NULL,
  payload     jsonb,                        -- raw incoming body, kept for debugging
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sirahagents_events_tenant_time_idx
  ON public.sirahagents_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sirahagents_events_email_idx
  ON public.sirahagents_events (email);

ALTER TABLE public.sirahagents_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.sirahagents_events
  FOR SELECT USING (tenant_id = current_tenant_id());

-- All writes happen via the service-role admin client (no INSERT/UPDATE policy for authenticated).
REVOKE ALL ON public.sirahagents_events FROM anon, authenticated;
GRANT SELECT ON public.sirahagents_events TO authenticated;
GRANT ALL    ON public.sirahagents_events TO service_role;
