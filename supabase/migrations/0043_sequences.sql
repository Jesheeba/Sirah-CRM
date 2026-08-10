-- 0043 Sales Sequences
-- Multi-step drip cadences (email/whatsapp/task) enrolled per-lead. Depends on #10
-- Workflow Engine (0009/0033 — reused only for its cron, not its trigger/action model;
-- a sequence's per-lead progression cursor doesn't fit the generic workflow shape) and
-- #17 Email tracking (0042 — inbound-reply detection reuses `communications`).
-- Run after 0001-0042. Idempotent.

-- ───────────────────────── Sequences + steps ─────────────────────────
create table if not exists public.sequences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists sequences_tenant_idx on public.sequences (tenant_id, is_active);

create table if not exists public.sequence_steps (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  step_order  int not null,
  channel     text not null check (channel in ('email','whatsapp','task')),
  delay_hours int not null default 0 check (delay_hours >= 0),  -- delay since the PREVIOUS step (or enrollment, for step 0)
  content     jsonb not null default '{}'::jsonb,               -- email: {subject,body}; whatsapp: {body}; task: {title}
  created_at  timestamptz not null default now(),
  unique (sequence_id, step_order)
);
create index if not exists sequence_steps_seq_idx on public.sequence_steps (sequence_id, step_order);

-- ───────────────────────── Enrollments ─────────────────────────
create table if not exists public.sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sequence_id   uuid not null references public.sequences(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  current_step  int not null default 0,
  status        text not null default 'active' check (status in ('active','stopped','completed')),
  stop_reason   text,
  last_error    text,
  next_run_at   timestamptz not null default now(),
  enrolled_by   uuid not null default auth.uid(),
  enrolled_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists sequence_enrollments_due_idx
  on public.sequence_enrollments (next_run_at) where status = 'active';
create index if not exists sequence_enrollments_lead_idx
  on public.sequence_enrollments (tenant_id, lead_id);
-- One active enrollment per (sequence, lead) — re-enrolling requires the prior run to finish.
create unique index if not exists sequence_enrollments_one_active
  on public.sequence_enrollments (sequence_id, lead_id) where status = 'active';

-- ───────────────────────── WhatsApp opt-outs ─────────────────────────
-- Shared by sequences (skip whatsapp steps for opted-out numbers) and any future
-- broadcast/campaign feature (#14) that needs the same suppression list.
create table if not exists public.whatsapp_optouts (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  phone         text not null,
  opted_out_at  timestamptz not null default now(),
  primary key (tenant_id, phone)
);

-- ───────────────────────── RLS ─────────────────────────
alter table public.sequences             enable row level security;
alter table public.sequence_steps        enable row level security;
alter table public.sequence_enrollments  enable row level security;
alter table public.whatsapp_optouts      enable row level security;

drop policy if exists seq_read on public.sequences;
create policy seq_read on public.sequences
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists seq_write on public.sequences;
create policy seq_write on public.sequences
  for all
  using (tenant_id = public.current_tenant_id() and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id() and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

drop policy if exists seqstep_read on public.sequence_steps;
create policy seqstep_read on public.sequence_steps
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists seqstep_write on public.sequence_steps;
create policy seqstep_write on public.sequence_steps
  for all
  using (tenant_id = public.current_tenant_id() and exists (
    select 1 from public.sequences s where s.id = sequence_id
      and (s.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))))
  with check (tenant_id = public.current_tenant_id() and exists (
    select 1 from public.sequences s where s.id = sequence_id
      and (s.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))));

-- Enrollments: any tenant member may read; any member may enroll/stop a lead they can see
-- (matches the leads write model — owner or Admin/Manager — since enrollment is a lead action).
drop policy if exists seqenr_read on public.sequence_enrollments;
create policy seqenr_read on public.sequence_enrollments
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists seqenr_write on public.sequence_enrollments;
create policy seqenr_write on public.sequence_enrollments
  for all
  using (tenant_id = public.current_tenant_id() and exists (
    select 1 from public.leads l where l.id = lead_id
      and (l.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))))
  with check (tenant_id = public.current_tenant_id() and exists (
    select 1 from public.leads l where l.id = lead_id
      and (l.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))));

drop policy if exists optout_read on public.whatsapp_optouts;
create policy optout_read on public.whatsapp_optouts
  for select using (tenant_id = public.current_tenant_id());
-- Writes happen only via the service-role webhook handlers (inbound STOP keyword) — no
-- client write policy; admins can still delete via the admin client if a number needs re-adding.

-- ───────────────────────── Triggers ─────────────────────────
drop trigger if exists stamp_tenant on public.sequences;
create trigger stamp_tenant before insert on public.sequences
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.sequences;
create trigger set_updated_at before update on public.sequences
  for each row execute function public.set_updated_at();
drop trigger if exists audit_sequences on public.sequences;
create trigger audit_sequences after insert or update or delete on public.sequences
  for each row execute function public.fn_audit();

drop trigger if exists stamp_tenant on public.sequence_steps;
create trigger stamp_tenant before insert on public.sequence_steps
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists stamp_tenant on public.sequence_enrollments;
create trigger stamp_tenant before insert on public.sequence_enrollments
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.sequence_enrollments;
create trigger set_updated_at before update on public.sequence_enrollments
  for each row execute function public.set_updated_at();

drop trigger if exists stamp_tenant on public.whatsapp_optouts;
create trigger stamp_tenant before insert on public.whatsapp_optouts
  for each row execute function public.fn_stamp_tenant();

-- ───────────────────────── Enrollment RPC ─────────────────────────
-- Runs as the enrolling user (not security definer) so RLS on sequence_enrollments still
-- gates who can enroll whom; sets next_run_at from step 0's own delay.
create or replace function public.fn_enroll_lead_in_sequence(p_sequence_id uuid, p_lead_id uuid)
returns uuid language plpgsql set search_path = public as $$
declare
  v_delay int;
  v_id    uuid;
begin
  select delay_hours into v_delay from public.sequence_steps
    where sequence_id = p_sequence_id and step_order = 0;
  if v_delay is null then
    raise exception 'Sequence has no steps';
  end if;

  insert into public.sequence_enrollments (sequence_id, lead_id, current_step, next_run_at)
  values (p_sequence_id, p_lead_id, 0, now() + make_interval(hours => v_delay))
  returning id into v_id;

  return v_id;
end; $$;
grant execute on function public.fn_enroll_lead_in_sequence(uuid, uuid) to authenticated;
