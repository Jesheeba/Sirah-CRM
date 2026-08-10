-- 0049 Bulk Email Campaigns
-- Segment → personalized send → open/click tracking (reuses #17's communications.open_token
-- scheme) → unsubscribe suppression. Depends on #17 (0042) for click tracking and reuses
-- fn_eval_routing_condition (0041) for segment matching — same {field,operator,value}
-- condition shape as lead routing, so the UI condition-builder is shared, not reinvented.
-- Run after 0001-0048. Idempotent.

create table if not exists public.email_campaigns (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  name             text not null,
  subject          text not null default '',
  body             text not null default '',
  audience         text not null check (audience in ('leads','contacts')),
  conditions       jsonb not null default '[]'::jsonb, -- same shape as routing_rules.conditions
  status           text not null default 'draft' check (status in ('draft','sending','sent','failed')),
  recipient_count  int not null default 0,
  sent_count       int not null default 0,
  failed_count     int not null default 0,
  owner_id         uuid not null default auth.uid(),
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists email_campaigns_tenant_idx on public.email_campaigns (tenant_id, status);

create table if not exists public.email_campaign_recipients (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  campaign_id      uuid not null references public.email_campaigns(id) on delete cascade,
  entity_type      text not null check (entity_type in ('lead','contact')),
  entity_id        uuid not null,
  email            text not null,
  communication_id uuid references public.communications(id) on delete set null,
  status           text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  skip_reason      text,
  created_at       timestamptz not null default now()
);
create index if not exists campaign_recipients_pending_idx
  on public.email_campaign_recipients (campaign_id) where status = 'pending';

create table if not exists public.email_suppressions (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  email        text not null,
  reason       text,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, email)
);

-- ───────────────────────── RLS ─────────────────────────
alter table public.email_campaigns            enable row level security;
alter table public.email_campaign_recipients   enable row level security;
alter table public.email_suppressions          enable row level security;

drop policy if exists ec_read on public.email_campaigns;
create policy ec_read on public.email_campaigns
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists ec_write on public.email_campaigns;
create policy ec_write on public.email_campaigns
  for all
  using (tenant_id = public.current_tenant_id() and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id() and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

drop policy if exists ecr_read on public.email_campaign_recipients;
create policy ecr_read on public.email_campaign_recipients
  for select using (tenant_id = public.current_tenant_id());
-- No client write policy — recipients are materialized by fn_resolve_campaign_recipients()
-- and sent by the service-role cron only.

drop policy if exists esup_read on public.email_suppressions;
create policy esup_read on public.email_suppressions
  for select using (tenant_id = public.current_tenant_id());
-- Writes happen via the public unsubscribe endpoint (service role) only.

drop trigger if exists stamp_tenant on public.email_campaigns;
create trigger stamp_tenant before insert on public.email_campaigns
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.email_campaigns;
create trigger set_updated_at before update on public.email_campaigns
  for each row execute function public.set_updated_at();
drop trigger if exists audit_email_campaigns on public.email_campaigns;
create trigger audit_email_campaigns after insert or update or delete on public.email_campaigns
  for each row execute function public.fn_audit();

drop trigger if exists stamp_tenant on public.email_campaign_recipients;
create trigger stamp_tenant before insert on public.email_campaign_recipients
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.email_suppressions;
create trigger stamp_tenant before insert on public.email_suppressions
  for each row execute function public.fn_stamp_tenant();

-- ───────────────────────── Segment resolution ─────────────────────────
-- Materializes the campaign's audience into email_campaign_recipients, one row per
-- matching lead/contact with a non-empty email, skipping anyone already suppressed.
-- Runs as the calling admin (not security definer) so RLS still gates who can send to whom.
create or replace function public.fn_resolve_campaign_recipients(p_campaign_id uuid)
returns int language plpgsql set search_path = public as $$
declare
  v_tenant     uuid := public.current_tenant_id();
  v_campaign   public.email_campaigns%rowtype;
  v_row        record;
  v_matches    boolean;
  v_cond       jsonb;
  v_count      int := 0;
begin
  select * into v_campaign from public.email_campaigns where id = p_campaign_id and tenant_id = v_tenant;
  if not found then raise exception 'Campaign not found'; end if;

  -- Leads and contacts have different schemas, so `select *` from each can't be UNIONed
  -- directly (column count/type mismatch). Projecting each row to (id, email, to_jsonb(row))
  -- first gives both branches an identical 3-column shape — the jsonb payload still carries
  -- every column (source, status, company, custom_fields, ...) for fn_eval_routing_condition.
  -- The `and v_campaign.audience = '...'` guard means only one branch yields rows per call.
  for v_row in
    (select t.id, t.email, to_jsonb(t) as data from public.leads t
       where t.tenant_id = v_tenant and t.email is not null and t.email <> '' and t.deleted_at is null
         and v_campaign.audience = 'leads')
    union all
    (select t.id, t.email, to_jsonb(t) as data from public.contacts t
       where t.tenant_id = v_tenant and t.email is not null and t.email <> '' and t.deleted_at is null
         and v_campaign.audience = 'contacts')
  loop
    v_matches := true;
    if jsonb_array_length(v_campaign.conditions) > 0 then
      for v_cond in select * from jsonb_array_elements(v_campaign.conditions) loop
        if not public.fn_eval_routing_condition(
          v_row.data, v_cond->>'field', v_cond->>'operator', v_cond->>'value'
        ) then
          v_matches := false;
          exit;
        end if;
      end loop;
    end if;
    if not v_matches then continue; end if;

    insert into public.email_campaign_recipients (tenant_id, campaign_id, entity_type, entity_id, email, status, skip_reason)
    values (
      v_tenant, p_campaign_id,
      case when v_campaign.audience = 'leads' then 'lead' else 'contact' end,
      v_row.id, v_row.email,
      case when exists (select 1 from public.email_suppressions s where s.tenant_id = v_tenant and s.email = v_row.email)
           then 'skipped' else 'pending' end,
      case when exists (select 1 from public.email_suppressions s where s.tenant_id = v_tenant and s.email = v_row.email)
           then 'unsubscribed' else null end
    );
    v_count := v_count + 1;
  end loop;

  update public.email_campaigns
     set recipient_count = v_count, status = 'sending'
   where id = p_campaign_id;

  return v_count;
end; $$;

grant execute on function public.fn_resolve_campaign_recipients(uuid) to authenticated;

-- ───────────────────────── Unsubscribe ─────────────────────────
-- Called by the public unsubscribe route for (logged-out) recipients — reuses the same
-- open_token issued for open/click tracking (0014/0042), so no new token scheme.
create or replace function public.fn_email_unsubscribe(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid;
  v_email  text;
begin
  select tenant_id, to_email into v_tenant, v_email
    from public.communications where open_token = p_token;

  if v_email is null then
    return null;
  end if;

  insert into public.email_suppressions (tenant_id, email, reason)
  values (v_tenant, v_email, 'unsubscribed')
  on conflict (tenant_id, email) do nothing;

  return v_email;
end; $$;

grant execute on function public.fn_email_unsubscribe(uuid) to anon, authenticated;
