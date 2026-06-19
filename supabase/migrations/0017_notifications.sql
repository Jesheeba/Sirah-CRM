-- 0017 Notifications (Phase 9): real-time delivery, more event types, per-user preferences.
-- Extends the Module 5 task-assignment foundation (notifications table + fn_notify_task_assignee).
-- Run after 0001-0016. Idempotent.

-- ───────────────────────── Preferences ─────────────────────────
create table if not exists public.notification_preferences (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  type       text not null,
  in_app     boolean not null default true,
  email      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, type)
);
alter table public.notification_preferences enable row level security;

-- Own rows only.
drop policy if exists np_own on public.notification_preferences;
create policy np_own on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists stamp_tenant on public.notification_preferences;
create trigger stamp_tenant before insert on public.notification_preferences
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.notification_preferences;
create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- Gate used by every notification trigger. Defaults to enabled when no row exists.
create or replace function public.fn_should_notify(p_user uuid, p_type text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce(
    (select in_app from public.notification_preferences where user_id = p_user and type = p_type),
    true);
$$;
grant execute on function public.fn_should_notify(uuid, text) to authenticated;

-- ───────────────────────── Triggers respect preferences ─────────────────────────
-- Task assignment (now preference-gated).
create or replace function public.fn_notify_task_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid()
     and public.fn_should_notify(new.assignee_id, 'task_assigned')
  then
    insert into public.notifications(tenant_id, user_id, type, title, link, entity_type, entity_id)
    values (new.tenant_id, new.assignee_id, 'task_assigned',
            'New task: ' || new.title, '/tasks/' || new.id, 'task', new.id);
  end if;
  return new;
end; $$;

-- Deal won → notify the deal owner.
create or replace function public.fn_notify_deal_won()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'won' and old.status is distinct from 'won'
     and new.owner_id is not null and new.owner_id is distinct from auth.uid()
     and public.fn_should_notify(new.owner_id, 'deal_won')
  then
    insert into public.notifications(tenant_id, user_id, type, title, link, entity_type, entity_id)
    values (new.tenant_id, new.owner_id, 'deal_won',
            'Deal won: ' || new.name, '/deals/' || new.id, 'deal', new.id);
  end if;
  return new;
end; $$;
drop trigger if exists notify_deal_won on public.deals;
create trigger notify_deal_won after update on public.deals
  for each row execute function public.fn_notify_deal_won();
grant execute on function public.fn_notify_deal_won() to authenticated;

-- Quotation accepted → notify the quote owner.
create or replace function public.fn_notify_quote_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'accepted' and old.status is distinct from 'accepted'
     and new.owner_id is not null and new.owner_id is distinct from auth.uid()
     and public.fn_should_notify(new.owner_id, 'quote_accepted')
  then
    insert into public.notifications(tenant_id, user_id, type, title, link, entity_type, entity_id)
    values (new.tenant_id, new.owner_id, 'quote_accepted',
            'Quotation accepted: Q-' || lpad(coalesce(new.quote_number, 0)::text, 5, '0'),
            '/quotations/' || new.id, 'quotation', new.id);
  end if;
  return new;
end; $$;
drop trigger if exists notify_quote_accepted on public.quotations;
create trigger notify_quote_accepted after update on public.quotations
  for each row execute function public.fn_notify_quote_accepted();
grant execute on function public.fn_notify_quote_accepted() to authenticated;

-- ───────────────────────── Real-time delivery ─────────────────────────
-- Add notifications to the Realtime publication so the bell updates live.
-- (RLS still applies: each user only receives their own rows.)
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;   -- already in the publication
  when undefined_object then null;   -- publication not present in this project
end $$;
