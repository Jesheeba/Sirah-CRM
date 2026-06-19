-- 0010 Tasks module completion: reminders, audit logging on tasks, and a
-- notifications foundation (task-assignment alerts). Additive + idempotent.
-- Run after 0001-0009. The tasks/notes/activities tables already exist (0003).

-- 1. Reminder field ----------------------------------------------------------
alter table public.tasks add column if not exists remind_at timestamptz;

-- 2. Audit logging on tasks (fn_audit already covers leads/deals/accounts/contacts).
drop trigger if exists audit_tasks on public.tasks;
create trigger audit_tasks after insert or update or delete on public.tasks
  for each row execute function public.fn_audit();

-- 3. Notifications (per-user; foundation that Phase 9 extends) ----------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  user_id     uuid not null,                 -- recipient (auth.users / profiles id)
  type        text not null,                 -- task_assigned | ...
  title       text not null,
  body        text,
  link        text,                          -- in-app route, e.g. /tasks/<id>
  entity_type text,
  entity_id   uuid,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (tenant_id, user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

-- Own-row only. Inserts happen via the SECURITY DEFINER trigger below, so there
-- is intentionally no client INSERT policy (users can't fabricate notifications).
drop policy if exists notif_own_read on public.notifications;
create policy notif_own_read on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists notif_own_update on public.notifications;
create policy notif_own_update on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists stamp_tenant on public.notifications;
create trigger stamp_tenant before insert on public.notifications
  for each row execute function public.fn_stamp_tenant();

-- 4. Notify the assignee when a task is assigned (incl. workflow-created tasks).
create or replace function public.fn_notify_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid()
  then
    insert into public.notifications(tenant_id, user_id, type, title, link, entity_type, entity_id)
    values (new.tenant_id, new.assignee_id, 'task_assigned',
            'New task: ' || new.title, '/tasks/' || new.id, 'task', new.id);
  end if;
  return new;
end; $$;

drop trigger if exists notify_task_assignee on public.tasks;
create trigger notify_task_assignee after insert or update on public.tasks
  for each row execute function public.fn_notify_task_assignee();

grant execute on function public.fn_notify_task_assignee() to authenticated;
