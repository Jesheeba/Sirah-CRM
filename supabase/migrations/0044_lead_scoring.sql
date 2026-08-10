-- 0044 Automatic Lead Scoring (rule-based)
-- `leads.score` has existed since 0002 but nothing ever wrote to it besides manual edits.
-- This wires it up: a shared `fn_apply_lead_score()` (logs to lead_score_events + updates
-- leads.score) called from real-time triggers on `communications`/`leads`, plus a daily
-- inactivity-decay batch (lib/lead-scoring.ts) called from /api/workflows/tick.
-- Run after 0001-0043. Idempotent.

-- ───────────────────────── Tenant-configurable rules ─────────────────────────
-- A tenant only needs a row here to OVERRIDE a default or explicitly disable an action
-- (is_active = false) — fn_apply_lead_score() falls back to the hardcoded defaults below
-- for any (tenant, action) with no row, so scoring works out of the box for every tenant.
create table if not exists public.lead_scoring_rules (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  action      text not null check (action in
                ('email_opened','email_clicked','replied','quote_viewed',
                 'meeting_scheduled','referral_source','inactivity_decay')),
  points      int not null,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, action)
);

-- ───────────────────────── Score event log ─────────────────────────
-- Audit trail + the mechanism that prevents the inactivity decay from re-firing daily.
create table if not exists public.lead_score_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  action      text not null,
  points      int not null,
  created_at  timestamptz not null default now()
);
create index if not exists lead_score_events_lead_idx on public.lead_score_events (tenant_id, lead_id, created_at desc);
create index if not exists lead_score_events_decay_idx on public.lead_score_events (lead_id, action, created_at desc);

alter table public.lead_scoring_rules enable row level security;
alter table public.lead_score_events  enable row level security;

drop policy if exists lsr_read on public.lead_scoring_rules;
create policy lsr_read on public.lead_scoring_rules
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists lsr_write on public.lead_scoring_rules;
create policy lsr_write on public.lead_scoring_rules
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
            with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop policy if exists lse_read on public.lead_score_events;
create policy lse_read on public.lead_score_events
  for select using (tenant_id = public.current_tenant_id());
-- No client write policy — only fn_apply_lead_score() (security definer) writes here.

-- ───────────────────────── Scoring engine ─────────────────────────
create or replace function public.fn_apply_lead_score(p_lead_id uuid, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant  uuid;
  v_points  int;
  v_active  boolean;
begin
  select tenant_id into v_tenant from public.leads where id = p_lead_id;
  if v_tenant is null then return; end if;

  select points, is_active into v_points, v_active
    from public.lead_scoring_rules where tenant_id = v_tenant and action = p_action;

  if v_active is false then return; end if; -- tenant explicitly disabled this action

  if v_points is null then
    v_points := case p_action
      when 'email_opened'      then 5
      when 'email_clicked'     then 10
      when 'replied'           then 20
      when 'quote_viewed'      then 25
      when 'meeting_scheduled' then 40
      when 'referral_source'   then 30
      when 'inactivity_decay'  then -10
      else 0
    end;
  end if;
  if v_points = 0 then return; end if;

  insert into public.lead_score_events (tenant_id, lead_id, action, points)
    values (v_tenant, p_lead_id, p_action, v_points);
  update public.leads set score = score + v_points where id = p_lead_id;
end; $$;
grant execute on function public.fn_apply_lead_score(uuid, text) to authenticated, service_role;

-- ───────────────────────── Triggers: communications (open/click/reply) ─────────────────────────
create or replace function public.fn_score_communications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.related_to_type = 'lead' and new.related_to_id is not null then
    if tg_op = 'INSERT' and new.direction = 'inbound' then
      perform public.fn_apply_lead_score(new.related_to_id, 'replied');
    end if;
    if tg_op = 'UPDATE' then
      if old.opened_at is null and new.opened_at is not null then
        perform public.fn_apply_lead_score(new.related_to_id, 'email_opened');
      end if;
      if old.clicked_at is null and new.clicked_at is not null then
        perform public.fn_apply_lead_score(new.related_to_id, 'email_clicked');
      end if;
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists score_communications on public.communications;
create trigger score_communications after insert or update on public.communications
  for each row execute function public.fn_score_communications();

-- ───────────────────────── Trigger: referral source on lead creation ─────────────────────────
create or replace function public.fn_score_lead_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source ilike '%referral%' then
    perform public.fn_apply_lead_score(new.id, 'referral_source');
  end if;
  return new;
end; $$;

drop trigger if exists score_lead_referral on public.leads;
create trigger score_lead_referral after insert on public.leads
  for each row execute function public.fn_score_lead_referral();
