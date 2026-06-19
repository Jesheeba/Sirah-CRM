-- 0011 Reporting: saved report configurations. Reports themselves read existing
-- tables (RLS already scopes to tenant); this only stores reusable filter presets.
-- Run after 0001-0010. Idempotent.

create table if not exists public.saved_reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  owner_id    uuid references public.profiles(id),
  name        text not null,
  report_type text not null,                     -- leads | deals | tasks | activities | sales
  config      jsonb not null default '{}'::jsonb, -- { from, to, filters: {...} }
  created_at  timestamptz not null default now()
);
create index if not exists saved_reports_idx on public.saved_reports (tenant_id, report_type);

alter table public.saved_reports enable row level security;

-- Shared within the tenant (any member can use a saved report).
drop policy if exists tenant_isolation on public.saved_reports;
create policy tenant_isolation on public.saved_reports
  for all using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop trigger if exists stamp_tenant on public.saved_reports;
create trigger stamp_tenant before insert on public.saved_reports
  for each row execute function public.fn_stamp_tenant();
