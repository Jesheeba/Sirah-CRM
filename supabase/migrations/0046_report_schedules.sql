-- 0046 Scheduled Reports
-- A schedule re-runs a saved report config on a cadence and emails the CSV to a
-- recipient list. Uses a relative `date_range` (not fixed from/to dates like
-- saved_reports.config) since a recurring schedule must re-anchor to "now" on every run.
-- No PDF: this codebase's only "PDF" path is browser print-to-PDF (window.print(), see
-- the (print) route group) — there's no server-side PDF renderer, and adding one
-- (e.g. Puppeteer/Chromium) is a heavy, Vercel-unfriendly dependency. A scheduled EMAIL
-- can't drive a browser print dialog, so the report body emails as a CSV attachment
-- instead, with a link to the in-app PDF-print view for anyone who wants a formatted copy.
-- See BUILD_BLOCKERS.md.
-- Run after 0001-0045. Idempotent.

create table if not exists public.report_schedules (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  name              text not null,
  report_type       text not null check (report_type in ('leads','deals','tasks','activities','sales')),
  filters           jsonb not null default '{}'::jsonb,
  date_range        text not null check (date_range in ('last_7_days','last_30_days','this_month','last_month','all_time')),
  cadence           text not null check (cadence in ('daily','weekly','monthly')),
  recipient_emails  text[] not null default '{}',
  is_active         boolean not null default true,
  last_sent_at      timestamptz,
  created_by        uuid not null default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists report_schedules_tenant_idx on public.report_schedules (tenant_id, is_active);

alter table public.report_schedules enable row level security;

drop policy if exists rs_read on public.report_schedules;
create policy rs_read on public.report_schedules
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists rs_write on public.report_schedules;
create policy rs_write on public.report_schedules
  for all using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'))
            with check (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'));

drop trigger if exists stamp_tenant on public.report_schedules;
create trigger stamp_tenant before insert on public.report_schedules
  for each row execute function public.fn_stamp_tenant();
