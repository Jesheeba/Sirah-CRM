-- 0028 Phase 1 gaps:
--   • Add lost_reason + probability columns to deals
--   • Replace move_deal_stage() to copy probability, enforce lost_reason

-- ------------------------------------------------------------------- deals --
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS probability  integer NOT NULL DEFAULT 0;

-- ----------------------------------------------- move_deal_stage (v2) -----
-- Drop the old 2-arg overload so PostgREST resolves unambiguously.
DROP FUNCTION IF EXISTS public.move_deal_stage(uuid, uuid);

CREATE OR REPLACE FUNCTION public.move_deal_stage(
  deal_id       uuid,
  to_stage_id   uuid,
  p_lost_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant      uuid := public.current_tenant_id();
  v_deal        public.deals%rowtype;
  v_stage       public.stages%rowtype;
  v_status      text;
  v_closed      timestamptz;
  v_probability integer;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No tenant context'; END IF;

  SELECT * INTO v_deal  FROM public.deals  WHERE id = deal_id     AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deal not found'; END IF;

  SELECT * INTO v_stage FROM public.stages WHERE id = to_stage_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stage not found'; END IF;

  IF v_stage.pipeline_id <> v_deal.pipeline_id THEN
    RAISE EXCEPTION 'Stage does not belong to this deal''s pipeline';
  END IF;

  IF v_stage.is_won THEN
    v_status      := 'won';
    v_closed      := now();
    v_probability := 100;
  ELSIF v_stage.is_lost THEN
    IF p_lost_reason IS NULL OR trim(p_lost_reason) = '' THEN
      RAISE EXCEPTION 'A reason is required when marking a deal as Lost';
    END IF;
    v_status      := 'lost';
    v_closed      := now();
    v_probability := 0;
  ELSE
    v_status      := 'open';
    v_closed      := NULL;
    v_probability := v_stage.probability;
  END IF;

  INSERT INTO public.deal_stage_history(tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
    VALUES (v_tenant, deal_id, v_deal.stage_id, to_stage_id, auth.uid());

  UPDATE public.deals
     SET stage_id    = to_stage_id,
         status      = v_status,
         closed_at   = v_closed,
         probability = v_probability,
         lost_reason = CASE WHEN v_stage.is_lost THEN p_lost_reason ELSE lost_reason END
   WHERE id = deal_id;

  RETURN (SELECT to_jsonb(d) FROM public.deals d WHERE d.id = deal_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_deal_stage(uuid, uuid, text) TO authenticated;
