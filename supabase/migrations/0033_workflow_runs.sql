-- 0033 Workflow Execution Engine — async queue layer.
-- Adds workflow_runs (the scheduler/async queue), extends action_type + trigger_type
-- constraints to cover send_email / send_whatsapp / assign_owner / webhook / schedule / event,
-- and updates fn_run_workflows() to enqueue async actions instead of trying to execute
-- them in PL/pgSQL (which can't make HTTP calls). Sync actions (create_task, update_field)
-- are unchanged.

-- ─── 1. workflow_runs table ──────────────────────────────────────────────────
create table if not exists public.workflow_runs (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  workflow_id   uuid        not null references public.workflows(id) on delete cascade,
  status        text        not null default 'pending'
                              check (status in ('pending','running','done','failed')),
  context       jsonb       not null default '{}'::jsonb,
  scheduled_for timestamptz,
  attempts      int         not null default 0,
  last_error    text,
  created_at    timestamptz not null default now()
);

-- Fast index for the tick worker to find pending work.
create index if not exists workflow_runs_pending_idx
  on public.workflow_runs (scheduled_for, id)
  where status = 'pending';

create index if not exists workflow_runs_tenant_created_idx
  on public.workflow_runs (tenant_id, created_at desc);

alter table public.workflow_runs enable row level security;

drop policy if exists wfrun_admin_all on public.workflow_runs;
create policy wfrun_admin_all on public.workflow_runs
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop trigger if exists stamp_tenant on public.workflow_runs;
create trigger stamp_tenant before insert on public.workflow_runs
  for each row execute function public.fn_stamp_tenant();

-- ─── 2. Extend action_type constraint ────────────────────────────────────────
alter table public.workflow_actions
  drop constraint if exists workflow_actions_action_type_check;

alter table public.workflow_actions
  add constraint workflow_actions_action_type_check
  check (action_type in (
    'create_task',
    'update_field',
    'send_email',
    'send_whatsapp',
    'assign_owner',
    'webhook'
  ));

-- ─── 3. Extend trigger_type constraint ───────────────────────────────────────
alter table public.workflow_triggers
  drop constraint if exists workflow_triggers_trigger_type_check;

alter table public.workflow_triggers
  add constraint workflow_triggers_trigger_type_check
  check (trigger_type in (
    'record_created',
    'record_updated',
    'field_changed',
    'schedule',
    'event'
  ));

-- ─── 4. Update fn_run_workflows to enqueue async actions ─────────────────────
create or replace function public.fn_run_workflows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity  text := tg_table_name;
  v_related text := left(tg_table_name, length(tg_table_name) - 1);
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
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  for w in
    select * from public.workflows
    where tenant_id = v_tenant
      and entity_type = v_entity
      and is_active = true
      and deleted_at is null
  loop
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

    for act in
      select * from public.workflow_actions where workflow_id = w.id
      order by execution_order, created_at
    loop
      begin
        -- ── Synchronous actions ──────────────────────────────────────────────
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

          insert into public.workflow_run_logs(tenant_id, workflow_id, entity_type, entity_id,
                                               trigger_type, status, detail)
          values (v_tenant, w.id, v_entity, new.id, v_event, 'success',
                  jsonb_build_object('action', act.action_type, 'config', act.config));

        elsif act.action_type = 'update_field' then
          perform public.fn_wf_update_field(v_entity, new.id, v_tenant,
                                            act.config ->> 'field', act.config ->> 'value');

          insert into public.workflow_run_logs(tenant_id, workflow_id, entity_type, entity_id,
                                               trigger_type, status, detail)
          values (v_tenant, w.id, v_entity, new.id, v_event, 'success',
                  jsonb_build_object('action', act.action_type, 'config', act.config));

        -- ── Async actions — enqueue for the tick worker ──────────────────────
        elsif act.action_type in ('send_email', 'send_whatsapp', 'assign_owner', 'webhook') then
          insert into public.workflow_runs(tenant_id, workflow_id, status, context, scheduled_for)
          values (
            v_tenant,
            w.id,
            'pending',
            jsonb_build_object(
              'action_id',    act.id,
              'action_type',  act.action_type,
              'config',       act.config,
              'entity_type',  v_entity,
              'entity_id',    new.id::text,
              'record',       v_new
            ),
            now()
          );
        end if;

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
