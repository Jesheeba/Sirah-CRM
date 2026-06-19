-- 0003 Tasks/Notes/Activities, Custom Fields, Audit & history.

-- ------------------------------------------------------ tasks/notes/activities --
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null,
  description   text,
  status        text not null default 'open',
  priority      text not null default 'normal',
  due_at        timestamptz,
  related_to_type text,
  related_to_id   uuid,
  assignee_id   uuid references public.profiles(id),
  owner_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1
);
create index on public.tasks (tenant_id, status);
create index on public.tasks (tenant_id, related_to_type, related_to_id);

create table public.notes (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  body          text not null,
  related_to_type text,
  related_to_id   uuid,
  owner_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on public.notes (tenant_id, related_to_type, related_to_id);

create table public.activities (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  type          text not null,
  subject       text,
  description   text,
  occurred_at   timestamptz not null default now(),
  related_to_type text,
  related_to_id   uuid,
  owner_id      uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.activities (tenant_id, related_to_type, related_to_id);

-- ------------------------------------------------------------- custom fields --
create table public.custom_field_definitions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  entity_type   text not null,
  field_key     text not null,
  label         text not null,
  data_type     text not null,
  options       jsonb,
  is_required   boolean not null default false,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, entity_type, field_key)
);
create index on public.custom_field_definitions (tenant_id, entity_type);

-- ------------------------------------------------------- deal stage history --
create table public.deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  from_stage_id uuid references public.stages(id),
  to_stage_id uuid not null references public.stages(id),
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index on public.deal_stage_history (tenant_id, deal_id);

-- ----------------------------------------------------------------- audit logs --
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  actor_id    uuid,
  action      text not null,
  entity_type text not null,
  entity_id   uuid not null,
  changes     jsonb,
  snapshot    jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_logs (tenant_id, entity_type, entity_id, created_at desc);
create index on public.audit_logs (tenant_id, actor_id, created_at desc);

create or replace function public.fn_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
  v_changes jsonb;
begin
  if (tg_op = 'UPDATE') then
    select jsonb_object_agg(key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_changes
    from jsonb_each(to_jsonb(old)) o
    join jsonb_each(to_jsonb(new)) n using (key)
    where o.value is distinct from n.value
      and key not in ('updated_at','version');
    if v_changes is null then return new; end if;
    insert into public.audit_logs(tenant_id, actor_id, action, entity_type, entity_id, changes)
      values (v_tenant, v_actor, 'update', tg_table_name, new.id, v_changes);
    return new;
  elsif (tg_op = 'INSERT') then
    insert into public.audit_logs(tenant_id, actor_id, action, entity_type, entity_id, snapshot)
      values (v_tenant, v_actor, 'insert', tg_table_name, new.id, to_jsonb(new));
    return new;
  else
    insert into public.audit_logs(tenant_id, actor_id, action, entity_type, entity_id, snapshot)
      values (v_tenant, v_actor, 'delete', tg_table_name, old.id, to_jsonb(old));
    return old;
  end if;
end; $$;

create trigger audit_leads after insert or update or delete on public.leads
  for each row execute function public.fn_audit();
create trigger audit_deals after insert or update or delete on public.deals
  for each row execute function public.fn_audit();
create trigger audit_accounts after insert or update or delete on public.accounts
  for each row execute function public.fn_audit();
create trigger audit_contacts after insert or update or delete on public.contacts
  for each row execute function public.fn_audit();

-- --------------------------------------------------------------------- RLS --
alter table public.tasks                    enable row level security;
alter table public.notes                    enable row level security;
alter table public.activities               enable row level security;
alter table public.custom_field_definitions enable row level security;
alter table public.deal_stage_history       enable row level security;
alter table public.audit_logs               enable row level security;

create policy tenant_isolation on public.tasks
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.notes
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.activities
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.custom_field_definitions
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy tenant_isolation on public.deal_stage_history
  for all using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
-- audit_logs: read-only, tenant-scoped (writes happen via security definer trigger)
create policy audit_read on public.audit_logs
  for select using (tenant_id = public.current_tenant_id());

create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.custom_field_definitions
  for each row execute function public.set_updated_at();
