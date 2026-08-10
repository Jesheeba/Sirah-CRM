-- 0041 Lead Auto-Assignment / Routing
-- Rules evaluated by priority (lowest first); first match assigns the lead's owner via
-- one of three strategies. Runs as a BEFORE INSERT trigger on `leads` so it applies
-- uniformly regardless of which code path created the lead (manual form, CSV import,
-- Meta Lead Ads webhook, public web-to-lead capture) — no per-caller duplication.
-- "Territory" routing (spec'd in the build doc as its own strategy) is modeled instead
-- as a condition on a field (e.g. a `city` custom field) combined with any strategy —
-- see BUILD_BLOCKERS.md for why.
-- Run after 0001-0040. Idempotent.

create table if not exists public.routing_rules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  name              text not null default 'Routing rule',
  priority          int not null default 0,                    -- lower runs first
  conditions        jsonb not null default '[]'::jsonb,         -- [{field,operator,value}] — AND across all; [] = always matches
  strategy          text not null check (strategy in ('round_robin','specific','load')),
  target_user_ids   uuid[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists routing_rules_tenant_idx on public.routing_rules (tenant_id, is_active, priority);

create table if not exists public.routing_state (
  rule_id     uuid primary key references public.routing_rules(id) on delete cascade,
  last_index  int not null default -1
);

alter table public.routing_rules enable row level security;
alter table public.routing_state enable row level security;

drop policy if exists routing_rules_read on public.routing_rules;
create policy routing_rules_read on public.routing_rules
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists routing_rules_admin_write on public.routing_rules;
create policy routing_rules_admin_write on public.routing_rules
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
            with check (tenant_id = public.current_tenant_id() and public.is_admin());

-- routing_state has no tenant_id of its own (1:1 with an already tenant-scoped rule) —
-- gate through the parent rule.
drop policy if exists routing_state_read on public.routing_state;
create policy routing_state_read on public.routing_state
  for select using (exists (
    select 1 from public.routing_rules r where r.id = rule_id and r.tenant_id = public.current_tenant_id()));
drop policy if exists routing_state_admin_write on public.routing_state;
create policy routing_state_admin_write on public.routing_state
  for all using (exists (
    select 1 from public.routing_rules r where r.id = rule_id and r.tenant_id = public.current_tenant_id() and public.is_admin()))
  with check (exists (
    select 1 from public.routing_rules r where r.id = rule_id and r.tenant_id = public.current_tenant_id() and public.is_admin()));

drop trigger if exists stamp_tenant on public.routing_rules;
create trigger stamp_tenant before insert on public.routing_rules
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.routing_rules;
create trigger set_updated_at before update on public.routing_rules
  for each row execute function public.set_updated_at();
drop trigger if exists audit_routing_rules on public.routing_rules;
create trigger audit_routing_rules after insert or update or delete on public.routing_rules
  for each row execute function public.fn_audit();

-- ───────────────────────── Condition evaluator ─────────────────────────
-- Reuses the same operator vocabulary as the workflow engine (0009) for consistency.
create or replace function public.fn_eval_routing_condition(
  p_lead jsonb, p_field text, p_operator text, p_value text
) returns boolean language plpgsql immutable as $$
declare
  v_val text;
begin
  if p_field like 'custom_fields.%' then
    v_val := p_lead->'custom_fields'->>substring(p_field from 15);
  else
    v_val := p_lead->>p_field;
  end if;

  return case p_operator
    when 'eq'       then v_val is not distinct from p_value
    when 'neq'      then v_val is distinct from p_value
    when 'contains' then v_val is not null and v_val ilike '%' || p_value || '%'
    when 'is_empty' then v_val is null or v_val = ''
    when 'gt'       then v_val ~ '^-?[0-9]+(\.[0-9]+)?$' and p_value ~ '^-?[0-9]+(\.[0-9]+)?$'
                          and v_val::numeric > p_value::numeric
    when 'lt'       then v_val ~ '^-?[0-9]+(\.[0-9]+)?$' and p_value ~ '^-?[0-9]+(\.[0-9]+)?$'
                          and v_val::numeric < p_value::numeric
    else false
  end;
end; $$;

-- ───────────────────────── Routing trigger ─────────────────────────
-- Only assigns when the lead has no explicit owner yet — never overrides a rep manually
-- creating and self-assigning a lead, or an import job that set owner_id itself.
create or replace function public.fn_route_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lead_json jsonb;
  v_rule      record;
  v_cond      jsonb;
  v_matches   boolean;
  v_target    uuid;
  v_idx       int;
begin
  if new.owner_id is not null then
    return new;
  end if;

  v_lead_json := to_jsonb(new);

  for v_rule in
    select * from public.routing_rules
    where tenant_id = new.tenant_id and is_active = true
    order by priority asc, created_at asc
  loop
    v_matches := true;
    if jsonb_array_length(v_rule.conditions) > 0 then
      for v_cond in select * from jsonb_array_elements(v_rule.conditions) loop
        if not public.fn_eval_routing_condition(
          v_lead_json, v_cond->>'field', v_cond->>'operator', v_cond->>'value'
        ) then
          v_matches := false;
          exit;
        end if;
      end loop;
    end if;

    if not v_matches or array_length(v_rule.target_user_ids, 1) is null then
      continue;
    end if;

    v_target := null;

    if v_rule.strategy = 'round_robin' then
      insert into public.routing_state(rule_id, last_index) values (v_rule.id, -1)
        on conflict (rule_id) do nothing;

      select last_index into v_idx from public.routing_state where rule_id = v_rule.id for update;
      v_idx := (v_idx + 1) % array_length(v_rule.target_user_ids, 1);
      update public.routing_state set last_index = v_idx where rule_id = v_rule.id;
      v_target := v_rule.target_user_ids[v_idx + 1]; -- arrays are 1-indexed

    elsif v_rule.strategy = 'load' then
      select u.id into v_target
        from unnest(v_rule.target_user_ids) as u(id)
        left join public.leads l
          on l.owner_id = u.id and l.tenant_id = new.tenant_id
         and l.status not in ('converted','unqualified') and l.deleted_at is null
        group by u.id
        order by count(l.id) asc, u.id asc
        limit 1;

    else -- 'specific'
      v_target := v_rule.target_user_ids[1];
    end if;

    if v_target is not null then
      new.owner_id := v_target;
      return new;
    end if;
  end loop;

  return new;
end; $$;

drop trigger if exists route_lead on public.leads;
create trigger route_lead before insert on public.leads
  for each row execute function public.fn_route_lead();
