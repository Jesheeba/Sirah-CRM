-- 0016 Calendar (Phase 8): a full team calendar of events/meetings that extends the
-- Module 5 task-scoped calendar. Events live in `calendar_events`; the calendar UI merges
-- them with task due dates. A per-user `ics_token` powers a zero-config iCal subscribe feed
-- (served via a SECURITY DEFINER function so no service-role is required). Google two-way
-- sync is a future extension — the `external_provider`/`external_id` columns are reserved for it.
-- Run after 0001-0015. Idempotent.

-- ───────────────────────── Events ─────────────────────────
create table if not exists public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  title             text not null,
  description       text,
  location          text,
  event_type        text not null default 'meeting'
                    check (event_type in ('meeting','call','event','reminder')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  all_day           boolean not null default false,
  related_to_type   text check (related_to_type in ('lead','contact','account','deal','quotation')),
  related_to_id     uuid,
  attendees         text,
  owner_id          uuid not null default auth.uid(),
  external_provider text,
  external_id       text,
  custom_fields     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index if not exists calendar_events_range_idx on public.calendar_events (tenant_id, starts_at);
create index if not exists calendar_events_owner_idx on public.calendar_events (tenant_id, owner_id, starts_at);

-- Per-user secret for the public iCal feed.
alter table public.profiles add column if not exists ics_token uuid not null default gen_random_uuid();
create unique index if not exists profiles_ics_token_idx on public.profiles (ics_token);

-- ───────────────────────── iCal feed ─────────────────────────
-- Returns a user's events + dated tasks for the public feed route. SECURITY DEFINER so
-- the (logged-out) calendar app fetch bypasses RLS; the token is the authorization.
create or replace function public.fn_calendar_feed(p_token uuid)
returns table (
  id          uuid,
  title       text,
  description text,
  location    text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  all_day     boolean,
  kind        text
) language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_tenant uuid;
begin
  select p.id, p.tenant_id into v_user, v_tenant
  from public.profiles p where p.ics_token = p_token;
  if v_user is null then return; end if;

  return query
    select e.id, e.title, e.description, e.location, e.starts_at, e.ends_at, e.all_day, 'event'::text
    from public.calendar_events e
    where e.tenant_id = v_tenant and e.owner_id = v_user and e.deleted_at is null
    union all
    select t.id, t.title, null::text, null::text, t.due_at, t.due_at, false, 'task'::text
    from public.tasks t
    where t.tenant_id = v_tenant and t.assignee_id = v_user
      and t.due_at is not null and t.deleted_at is null;
end; $$;
grant execute on function public.fn_calendar_feed(uuid) to anon, authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.calendar_events enable row level security;

-- Read = any tenant member (team calendar); write = owner or Admin/Manager.
drop policy if exists ce_read on public.calendar_events;
create policy ce_read on public.calendar_events
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists ce_write on public.calendar_events;
create policy ce_write on public.calendar_events
  for all
  using (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

-- ───────────────────────── Triggers ─────────────────────────
drop trigger if exists stamp_tenant on public.calendar_events;
create trigger stamp_tenant before insert on public.calendar_events
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists set_updated_at on public.calendar_events;
create trigger set_updated_at before update on public.calendar_events
  for each row execute function public.set_updated_at();

drop trigger if exists audit_calendar_events on public.calendar_events;
create trigger audit_calendar_events after insert or update or delete on public.calendar_events
  for each row execute function public.fn_audit();
