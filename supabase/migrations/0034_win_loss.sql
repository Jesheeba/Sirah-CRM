-- 0034 Win-Loss Analysis
-- Adds lost_notes to deals, settings JSONB to tenants (stores win_loss_reasons list),
-- updates move_deal_stage() to capture notes, adds win-loss report RPC.

-- ─── 1. Schema additions ──────────────────────────────────────────────────────
alter table public.deals
  add column if not exists lost_notes text;

alter table public.tenants
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- ─── 2. move_deal_stage v3 — accept lost_notes ───────────────────────────────
drop function if exists public.move_deal_stage(uuid, uuid, text);

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
     set stage_id    = to_stage_id,
         status      = v_status,
         closed_at   = v_closed,
         probability = v_probability,
         lost_reason = case when v_stage.is_lost then p_lost_reason else lost_reason end,
         lost_notes  = case when v_stage.is_lost then p_lost_notes  else lost_notes  end
   where id = deal_id;

  return (select to_jsonb(d) from public.deals d where d.id = deal_id);
end; $$;

grant execute on function public.move_deal_stage(uuid, uuid, text, text) to authenticated;

-- ─── 3. Win-Loss report RPC ───────────────────────────────────────────────────
create or replace function public.get_winloss_report(
  from_date  timestamptz default now() - interval '90 days',
  to_date    timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;

  select jsonb_build_object(
    -- overall win rate
    'summary', jsonb_build_object(
      'won',      count(*) filter (where status = 'won'),
      'lost',     count(*) filter (where status = 'lost'),
      'total',    count(*) filter (where status in ('won','lost')),
      'win_rate', round(
        100.0 * count(*) filter (where status = 'won')::numeric
               / nullif(count(*) filter (where status in ('won','lost')), 0),
        1
      ),
      'value_won',  coalesce(sum(amount) filter (where status = 'won'),  0),
      'value_lost', coalesce(sum(amount) filter (where status = 'lost'), 0)
    ),
    -- loss reason breakdown
    'reasons', (
      select coalesce(jsonb_agg(r order by r->>'count' desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'reason', coalesce(lost_reason, 'Unknown'),
          'count',  count(*),
          'value',  coalesce(sum(amount), 0)
        ) as r
        from public.deals
        where tenant_id = v_tenant
          and status = 'lost'
          and closed_at between from_date and to_date
        group by lost_reason
      ) sub
    ),
    -- win rate by owner
    'by_owner', (
      select coalesce(jsonb_agg(o order by (o->>'won')::int desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'owner_id',   d.owner_id::text,
          'owner_name', coalesce(p.full_name, p.email, 'Unknown'),
          'won',        count(*) filter (where d.status = 'won'),
          'lost',       count(*) filter (where d.status = 'lost'),
          'win_rate',   round(
            100.0 * count(*) filter (where d.status = 'won')::numeric
                   / nullif(count(*) filter (where d.status in ('won','lost')), 0),
            1
          ),
          'value_won',  coalesce(sum(d.amount) filter (where d.status = 'won'), 0)
        ) as o
        from public.deals d
        left join public.profiles p on p.id = d.owner_id
        where d.tenant_id = v_tenant
          and d.status in ('won','lost')
          and d.closed_at between from_date and to_date
        group by d.owner_id, p.full_name, p.email
      ) sub
    )
  )
  into v_result
  from public.deals
  where tenant_id = v_tenant
    and status in ('won','lost')
    and closed_at between from_date and to_date;

  return coalesce(v_result, jsonb_build_object(
    'summary', jsonb_build_object('won',0,'lost',0,'total',0,'win_rate',null,'value_won',0,'value_lost',0),
    'reasons', '[]'::jsonb,
    'by_owner', '[]'::jsonb
  ));
end; $$;

grant execute on function public.get_winloss_report(timestamptz, timestamptz) to authenticated;

-- ─── 4. RPC to read / write tenant settings ──────────────────────────────────
create or replace function public.get_tenant_settings()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(settings, '{}'::jsonb)
  from public.tenants
  where id = public.current_tenant_id();
$$;

create or replace function public.update_tenant_settings(p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin role required';
  end if;
  update public.tenants
     set settings = coalesce(settings, '{}'::jsonb) || p_settings
   where id = public.current_tenant_id();
end; $$;

grant execute on function public.get_tenant_settings()          to authenticated;
grant execute on function public.update_tenant_settings(jsonb)  to authenticated;
