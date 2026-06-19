-- 0014 Email (Phase 6): templates + a channel-aware communications log.
-- Provider-agnostic: works as compose→mailto+log with zero config; if a transactional
-- provider is wired later (env RESEND_API_KEY), the same rows carry real send + open tracking.
-- The `communications` table is channel-aware so Phase 7 (WhatsApp) reuses it.
-- Run after 0001-0013. Idempotent.

-- ───────────────────────── Templates ─────────────────────────
create table if not exists public.email_templates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  channel     text not null default 'email' check (channel in ('email','whatsapp','sms')),
  category    text,
  subject     text not null default '',
  body        text not null default '',
  is_active   boolean not null default true,
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists email_templates_tenant_idx on public.email_templates (tenant_id, channel);

-- ───────────────────────── Communications log ─────────────────────────
create table if not exists public.communications (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  channel             text not null default 'email' check (channel in ('email','whatsapp','sms')),
  direction           text not null default 'outbound' check (direction in ('outbound','inbound')),
  status              text not null default 'sent'
                      check (status in ('draft','queued','sent','failed','delivered','opened','clicked','received')),
  to_email            text,
  to_name             text,
  from_email          text,
  cc                  text,
  bcc                 text,
  subject             text,
  body                text,
  template_id         uuid references public.email_templates(id) on delete set null,
  related_to_type     text check (related_to_type in ('lead','contact','account','deal','quotation')),
  related_to_id       uuid,
  quotation_id        uuid references public.quotations(id) on delete set null,
  provider            text,
  provider_message_id text,
  open_token          uuid not null default gen_random_uuid(),
  sent_at             timestamptz not null default now(),
  opened_at           timestamptz,
  clicked_at          timestamptz,
  owner_id            uuid not null default auth.uid(),
  created_at          timestamptz not null default now()
);
create index if not exists communications_feed_idx    on public.communications (tenant_id, channel, direction, sent_at desc);
create index if not exists communications_related_idx on public.communications (tenant_id, related_to_type, related_to_id);
create index if not exists communications_token_idx   on public.communications (open_token);

-- ───────────────────────── Open tracking ─────────────────────────
-- Called by the public pixel route for (logged-out) recipients, so it must bypass RLS.
create or replace function public.fn_email_track_open(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.communications
     set opened_at = coalesce(opened_at, now()),
         status    = case when status in ('clicked') then status else 'opened' end
   where open_token = p_token
     and opened_at is null;
end; $$;
grant execute on function public.fn_email_track_open(uuid) to anon, authenticated;

-- ───────────────────────── RLS ─────────────────────────
alter table public.email_templates enable row level security;
alter table public.communications  enable row level security;

-- Templates: read = any tenant member; write = owner or Admin/Manager.
drop policy if exists et_read on public.email_templates;
create policy et_read on public.email_templates
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists et_write on public.email_templates;
create policy et_write on public.email_templates
  for all
  using (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

-- Communications: read = any tenant member; write = owner or Admin/Manager.
-- (Open tracking updates run through the SECURITY DEFINER function above.)
drop policy if exists comm_read on public.communications;
create policy comm_read on public.communications
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists comm_write on public.communications;
create policy comm_write on public.communications
  for all
  using (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

-- ───────────────────────── Triggers ─────────────────────────
drop trigger if exists stamp_tenant on public.email_templates;
create trigger stamp_tenant before insert on public.email_templates
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.communications;
create trigger stamp_tenant before insert on public.communications
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists set_updated_at on public.email_templates;
create trigger set_updated_at before update on public.email_templates
  for each row execute function public.set_updated_at();

drop trigger if exists audit_email_templates on public.email_templates;
create trigger audit_email_templates after insert or update or delete on public.email_templates
  for each row execute function public.fn_audit();
drop trigger if exists audit_communications on public.communications;
create trigger audit_communications after insert or update or delete on public.communications
  for each row execute function public.fn_audit();
