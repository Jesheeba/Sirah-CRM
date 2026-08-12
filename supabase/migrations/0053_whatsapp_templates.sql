-- 0053 WhatsApp Business message templates (Tech Provider capability).
-- Lets a tenant build/submit/track Meta-approved WhatsApp templates from inside the
-- CRM instead of going into WhatsApp Manager directly. Standalone table — not part of
-- the channel-aware `communications` log (those rows track individual sends, not the
-- Meta-side template definitions/approval lifecycle).
--
-- Run after 0001-0052. Idempotent.
--
-- Security model: mirrors 0021_integration_settings. RLS scopes rows to the tenant;
-- column-level privileges further restrict what `authenticated` can write. Meta is the
-- source of truth for approval state, so status/meta_template_id/rejection_reason/
-- quality_score/submitted_at/reviewed_at are writable only by the service-role client
-- (server actions that call the Graph API, and the status-update webhook) — never
-- directly by a tenant user, even an Admin. Tenant users may only create/edit the
-- DRAFT content (name/language/category/components) and read everything.

-- 1. Table ------------------------------------------------------------------------
create table if not exists public.whatsapp_templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  waba_id           text not null,
  meta_template_id  text,
  name              text not null,
  language          text not null,
  category          text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  components        jsonb not null,
  status            text not null default 'DRAFT'
                     check (status in ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED')),
  rejection_reason  text,
  quality_score     text,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  owner_id          uuid not null default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (tenant_id, name, language)
);

create index if not exists whatsapp_templates_tenant_idx
  on public.whatsapp_templates (tenant_id, status);
-- Lookup path for the status-update webhook, which is WABA-scoped (no tenant context
-- until this row is found) and keys strictly on waba_id + name + language.
create index if not exists whatsapp_templates_lookup_idx
  on public.whatsapp_templates (waba_id, name, language);

-- 2. Triggers: reuse the existing tenant stamp (0006) + audit (0014) helpers. --------
drop trigger if exists stamp_tenant on public.whatsapp_templates;
create trigger stamp_tenant before insert on public.whatsapp_templates
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists audit_whatsapp_templates on public.whatsapp_templates;
create trigger audit_whatsapp_templates after insert or update or delete on public.whatsapp_templates
  for each row execute function public.fn_audit();

-- 3. RLS: members read their tenant's rows; only admins write (mirrors 0021). --------
alter table public.whatsapp_templates enable row level security;

drop policy if exists wt_read on public.whatsapp_templates;
create policy wt_read on public.whatsapp_templates
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists wt_admin_write on public.whatsapp_templates;
create policy wt_admin_write on public.whatsapp_templates
  for all
  using (tenant_id = public.current_tenant_id() and public.is_admin())
  with check (tenant_id = public.current_tenant_id() and public.is_admin());

-- 4. Column privileges: RLS can't hide columns, and here the concern isn't secrecy but
--    authority — approval state must come only from Meta (via server-role code), never
--    a direct client write. Revoke everything from anon/authenticated first, then grant
--    back only the columns a tenant Admin should touch directly.
revoke all on public.whatsapp_templates from anon;
revoke all on public.whatsapp_templates from authenticated;

grant select (
  id, tenant_id, waba_id, meta_template_id, name, language, category, components,
  status, rejection_reason, quality_score, submitted_at, reviewed_at, owner_id, created_at
) on public.whatsapp_templates to authenticated;

-- Admins may create/edit the DRAFT content directly (RLS wt_admin_write still gates
-- rows). tenant_id is included so the insert statement can reference it even though the
-- stamp_tenant trigger overwrites it with the authenticated tenant. status/meta_template_id/
-- rejection_reason/quality_score/submitted_at/reviewed_at/waba_id are intentionally
-- omitted — only the service-role client (submit/edit/delete server actions and the
-- webhook) can set them, so a template can never self-report as approved.
grant insert (
  tenant_id, name, language, category, components
) on public.whatsapp_templates to authenticated;
grant update (
  name, language, category, components
) on public.whatsapp_templates to authenticated;
-- No delete grant: deleting a submitted template must also delete it on Meta's side, so
-- deletes always go through the service-role delete server action, never a direct client
-- write. (A DRAFT-only local row still deletes the same way — one code path, no drift.)

grant all on public.whatsapp_templates to service_role;
