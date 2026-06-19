-- 0009 Workflow Automation: the "if this, then that" engine.
-- 4 config tables (workflows / triggers / conditions / actions) + a run-log, plus an
-- in-database plpgsql engine fired by AFTER INSERT/UPDATE triggers on the entity tables
-- (mirrors fn_audit in 0003). Run after 0001-0008. Idempotent where practical.

-- ============================================================ TABLES =========
create table if not exists public.workflows (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  entity_type text not null check (entity_type in ('leads','contacts','accounts','deals')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists workflows_tenant_entity_idx on public.workflows (tenant_id, entity_type);

create table if not exists public.workflow_triggers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('record_created','record_updated','field_changed')),
  config       jsonb not null default '{}'::jsonb,   -- e.g. {"field":"stage_id"}
  created_at   timestamptz not null default now()
);
create index if not exists workflow_triggers_wf_idx on public.workflow_triggers (workflow_id);

create table if not exists public.workflow_conditions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  group_no    integer not null default 1,
  field       text not null,
  operator    text not null check (operator in ('eq','neq','gt','lt','contains','is_empty','changed_to')),
  value       jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists workflow_conditions_wf_idx on public.workflow_conditions (workflow_id);

create table if not exists public.workflow_actions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  workflow_id     uuid not null references public.workflows(id) on delete cascade,
  action_type     text not null check (action_type in ('create_task','update_field')),
  config          jsonb not null default '{}'::jsonb,  -- {"title":...} or {"field":...,"value":...}
  execution_order integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists workflow_actions_wf_idx on public.workflow_actions (workflow_id);

create table if not exists public.workflow_run_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  workflow_id  uuid references public.workflows(id) on delete cascade,
  entity_type  text,
  entity_id    uuid,
  trigger_type text,
  status       text not null check (status in ('success','error')),
  detail       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists workflow_run_logs_idx on public.workflow_run_logs (tenant_id, workflow_id, created_at desc);

-- ============================================================ RLS ============
-- Management is admin-only (like custom_field_definitions in 0008). The engine runs
-- SECURITY DEFINER so it reads/writes regardless of these policies.
alter table public.workflows           enable row level security;
alter table public.workflow_triggers   enable row level security;
alter table public.workflow_conditions enable row level security;
alter table public.workflow_actions    enable row level security;
alter table public.workflow_run_logs   enable row level security;

drop policy if exists wf_admin_all on public.workflows;
create policy wf_admin_all on public.workflows
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists wft_admin_all on public.workflow_triggers;
create policy wft_admin_all on public.workflow_triggers
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists wfc_admin_all on public.workflow_conditions;
create policy wfc_admin_all on public.workflow_conditions
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists wfa_admin_all on public.workflow_actions;
create policy wfa_admin_all on public.workflow_actions
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists wfl_admin_read on public.workflow_run_logs;
create policy wfl_admin_read on public.workflow_run_logs
  for select using (tenant_id = public.current_tenant_id() and public.is_admin());

-- ================================================== TENANT STAMPING ==========
drop trigger if exists stamp_tenant on public.workflows;
create trigger stamp_tenant before insert on public.workflows
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.workflow_triggers;
create trigger stamp_tenant before insert on public.workflow_triggers
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.workflow_conditions;
create trigger stamp_tenant before insert on public.workflow_conditions
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.workflow_actions;
create trigger stamp_tenant before insert on public.workflow_actions
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.workflow_run_logs;
create trigger stamp_tenant before insert on public.workflow_run_logs
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists set_updated_at on public.workflows;
create trigger set_updated_at before update on public.workflows
  for each row execute function public.set_updated_at();

-- ======================================================= ENGINE =============
-- Evaluate one condition: `field operator value` against the new (and old) record.
create or replace function public.fn_wf_eval_condition(
  p_field text, p_op text, p_value jsonb, p_new jsonb, p_old jsonb
) returns boolean
language plpgsql
immutable
as $$
declare
  v_cur text := p_new ->> p_field;
  v_cmp text := case when p_value is null then null else p_value #>> '{}' end;
  v_old text := case when p_old is null then null else p_old ->> p_field end;
begin
  return case p_op
    when 'eq'         then v_cur is not distinct from v_cmp
    when 'neq'        then v_cur is distinct from v_cmp
    when 'gt'         then v_cur::numeric > v_cmp::numeric
    when 'lt'         then v_cur::numeric < v_cmp::numeric
    when 'contains'   then v_cur ilike '%' || v_cmp || '%'
    when 'is_empty'   then v_cur is null or v_cur = ''
    when 'changed_to' then (v_cur is not distinct from v_cmp) and (v_old is distinct from v_cur)
    else false
  end;
exception when others then
  return false;  -- bad numeric cast etc. → condition fails safe
end; $$;

-- All conditions for a workflow: AND within a group_no, OR across groups. Empty = true.
create or replace function public.fn_wf_conditions_match(
  p_workflow uuid, p_new jsonb, p_old jsonb
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total int;
  g int;
  c record;
  v_group_ok boolean;
begin
  select count(*) into v_total from public.workflow_conditions where workflow_id = p_workflow;
  if v_total = 0 then return true; end if;

  for g in select distinct group_no from public.workflow_conditions where workflow_id = p_workflow loop
    v_group_ok := true;
    for c in select * from public.workflow_conditions where workflow_id = p_workflow and group_no = g loop
      if not public.fn_wf_eval_condition(c.field, c.operator, c.value, p_new, p_old) then
        v_group_ok := false;
        exit;
      end if;
    end loop;
    if v_group_ok then return true; end if;  -- OR across groups
  end loop;
  return false;
end; $$;

-- Safely update one allow-listed column on one row. %L embeds an untyped literal so
-- Postgres coerces it to the real column type (int/numeric/uuid/date/text).
create or replace function public.fn_wf_update_field(
  p_entity text, p_id uuid, p_tenant uuid, p_field text, p_value text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_entity not in ('leads','contacts','accounts','deals') then return; end if;
  if p_field is null or p_field !~ '^[a-z_][a-z0-9_]*$' then return; end if;
  execute format(
    'update public.%I set %I = %L where id = %L and tenant_id = %L',
    p_entity, p_field, p_value, p_id::text, p_tenant::text
  );
end; $$;

-- The engine: fires AFTER INSERT/UPDATE on entity tables.
create or replace function public.fn_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity  text := tg_table_name;                               -- leads|contacts|accounts|deals
  v_related text := left(tg_table_name, length(tg_table_name) - 1);  -- lead|contact|account|deal
  v_event   text := case when tg_op = 'INSERT' then 'record_created' else 'record_updated' end;
  v_tenant  uuid := new.tenant_id;
  v_new     jsonb := to_jsonb(new);
  v_old     jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  w   record;
  trg record;
  act record;
  v_field text;
  v_fires boolean;
begin
  -- Recursion guard: an update_field action re-enters this trigger at depth 2; skip it.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  for w in
    select * from public.workflows
    where tenant_id = v_tenant and entity_type = v_entity
      and is_active = true and deleted_at is null
  loop
    -- Does any trigger on this workflow match the current event?
    v_fires := false;
    for trg in select * from public.workflow_triggers where workflow_id = w.id loop
      if trg.trigger_type = v_event then
        v_fires := true;
      elsif trg.trigger_type = 'field_changed' and tg_op = 'UPDATE' then
        v_field := trg.config ->> 'field';
        if v_field is not null and (v_old -> v_field) is distinct from (v_new -> v_field) then
          v_fires := true;
        end if;
      end if;
      exit when v_fires;
    end loop;

    if not v_fires then continue; end if;
    if not public.fn_wf_conditions_match(w.id, v_new, v_old) then continue; end if;

    -- Run actions in order; each isolated so one failure doesn't abort the rest.
    for act in
      select * from public.workflow_actions where workflow_id = w.id
      order by execution_order, created_at
    loop
      begin
        if act.action_type = 'create_task' then
          insert into public.tasks(tenant_id, title, description, priority, due_at,
                                   related_to_type, related_to_id, owner_id, assignee_id)
          values (
            v_tenant,
            coalesce(nullif(act.config ->> 'title', ''), 'Workflow task'),
            nullif(act.config ->> 'description', ''),
            coalesce(nullif(act.config ->> 'priority', ''), 'normal'),
            case when coalesce(act.config ->> 'due_in_days', '') <> ''
                 then now() + ((act.config ->> 'due_in_days') || ' days')::interval
                 else null end,
            v_related, new.id, new.owner_id, new.owner_id
          );
        elsif act.action_type = 'update_field' then
          perform public.fn_wf_update_field(v_entity, new.id, v_tenant,
                                            act.config ->> 'field', act.config ->> 'value');
        end if;

        insert into public.workflow_run_logs(tenant_id, workflow_id, entity_type, entity_id,
                                             trigger_type, status, detail)
        values (v_tenant, w.id, v_entity, new.id, v_event, 'success',
                jsonb_build_object('action', act.action_type, 'config', act.config));
      exception when others then
        insert into public.workflow_run_logs(tenant_id, workflow_id, entity_type, entity_id,
                                             trigger_type, status, detail)
        values (v_tenant, w.id, v_entity, new.id, v_event, 'error',
                jsonb_build_object('action', act.action_type, 'error', sqlerrm));
      end;
    end loop;
  end loop;

  return new;
end; $$;

-- Attach the engine to the entity tables.
drop trigger if exists run_workflows on public.leads;
create trigger run_workflows after insert or update on public.leads
  for each row execute function public.fn_run_workflows();
drop trigger if exists run_workflows on public.contacts;
create trigger run_workflows after insert or update on public.contacts
  for each row execute function public.fn_run_workflows();
drop trigger if exists run_workflows on public.accounts;
create trigger run_workflows after insert or update on public.accounts
  for each row execute function public.fn_run_workflows();
drop trigger if exists run_workflows on public.deals;
create trigger run_workflows after insert or update on public.deals
  for each row execute function public.fn_run_workflows();

grant execute on function public.fn_wf_eval_condition(text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.fn_wf_conditions_match(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.fn_wf_update_field(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.fn_run_workflows() to authenticated;
