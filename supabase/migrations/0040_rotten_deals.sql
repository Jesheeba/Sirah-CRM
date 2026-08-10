-- 0040 Rotten Deals Detection
-- A deal is "rotten" when it has sat in its current stage longer than that stage's
-- configured threshold. Detection + one-time notification runs in the existing daily
-- cron (/api/workflows/tick, see lib/rotten-deals.ts) rather than a new schedule.
-- Run after 0001-0039. Idempotent.

-- ───────────────────────── stages — per-stage threshold ─────────────────────────
-- NULL = rotten tracking disabled for that stage (the common case for Won/Lost stages,
-- where "stale" is meaningless).
alter table public.stages
  add column if not exists rotten_after_days int check (rotten_after_days is null or rotten_after_days > 0);

-- ───────────────────────── deals — staleness clock ─────────────────────────
alter table public.deals
  add column if not exists last_stage_change_at timestamptz,
  add column if not exists rotten_notified_at    timestamptz;

-- Backfill from the most recent recorded stage change, falling back to created_at for
-- deals that predate deal_stage_history tracking.
update public.deals d
   set last_stage_change_at = coalesce(
         (select max(h.changed_at) from public.deal_stage_history h where h.deal_id = d.id),
         d.created_at
       )
 where last_stage_change_at is null;

alter table public.deals
  alter column last_stage_change_at set not null,
  alter column last_stage_change_at set default now();

-- ───────────────────────── move_deal_stage v4 — reset the clock on every move ─────
-- Same signature as v3 (0028) — only the body changes. Any stage change (not just
-- won/lost) resets last_stage_change_at and clears a prior rotten flag, since the
-- deal is no longer stale in its new stage.
create or replace function public.move_deal_stage(
  deal_id        uuid,
  to_stage_id    uuid,
  p_lost_reason  text default null,
  p_lost_notes   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant      uuid := public.current_tenant_id();
  v_deal        public.deals%rowtype;
  v_stage       public.stages%rowtype;
  v_status      text;
  v_closed      timestamptz;
  v_probability integer;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;

  select * into v_deal  from public.deals  where id = deal_id     and tenant_id = v_tenant;
  if not found then raise exception 'Deal not found'; end if;

  select * into v_stage from public.stages where id = to_stage_id and tenant_id = v_tenant;
  if not found then raise exception 'Stage not found'; end if;

  if v_stage.pipeline_id <> v_deal.pipeline_id then
    raise exception 'Stage does not belong to this deal''s pipeline';
  end if;

  if v_stage.is_won then
    v_status      := 'won';
    v_closed      := now();
    v_probability := 100;
  elsif v_stage.is_lost then
    if p_lost_reason is null or trim(p_lost_reason) = '' then
      raise exception 'A reason is required when marking a deal as Lost';
    end if;
    v_status      := 'lost';
    v_closed      := now();
    v_probability := 0;
  else
    v_status      := 'open';
    v_closed      := null;
    v_probability := v_stage.probability;
  end if;

  insert into public.deal_stage_history(tenant_id, deal_id, from_stage_id, to_stage_id, changed_by)
    values (v_tenant, deal_id, v_deal.stage_id, to_stage_id, auth.uid());

  update public.deals
     set stage_id              = to_stage_id,
         status                = v_status,
         closed_at             = v_closed,
         probability           = v_probability,
         lost_reason           = case when v_stage.is_lost then p_lost_reason else lost_reason end,
         lost_notes            = case when v_stage.is_lost then p_lost_notes  else lost_notes  end,
         last_stage_change_at  = now(),
         rotten_notified_at    = null
   where id = deal_id;

  return (select to_jsonb(d) from public.deals d where d.id = deal_id);
end; $$;

grant execute on function public.move_deal_stage(uuid, uuid, text, text) to authenticated;
