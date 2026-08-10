-- 0045 Sales Goals & Targets
-- No `teams` table exists in this codebase (RBAC is a fixed Admin/Manager/Sales Rep
-- model, not team-based — see BUILD_BLOCKERS.md), so "team_id" from the original spec
-- is dropped: a target with user_id = NULL is the whole-tenant ("team") target instead.
-- Progress is computed live from `deals` (status='won', closed_at in the period) —
-- deliberately not stored/denormalized, so it can never drift from the actual data.
-- Run after 0001-0044. Idempotent.

create table if not exists public.sales_targets (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  user_id       uuid references public.profiles(id) on delete cascade, -- null = whole-tenant target
  period        text not null,   -- 'YYYY-MM'
  metric        text not null check (metric in ('revenue','deals_won')),
  target_value  numeric(14,2) not null check (target_value > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two partial unique indexes (not one plain unique constraint) because Postgres treats
-- NULL as distinct-from-itself in a unique constraint — without this, multiple
-- whole-tenant targets for the same period+metric could be inserted silently.
create unique index if not exists sales_targets_user_unique
  on public.sales_targets (tenant_id, user_id, period, metric) where user_id is not null;
create unique index if not exists sales_targets_org_unique
  on public.sales_targets (tenant_id, period, metric) where user_id is null;
create index if not exists sales_targets_period_idx on public.sales_targets (tenant_id, period);

alter table public.sales_targets enable row level security;

drop policy if exists st_read on public.sales_targets;
create policy st_read on public.sales_targets
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists st_write on public.sales_targets;
create policy st_write on public.sales_targets
  for all using (tenant_id = public.current_tenant_id() and public.is_admin())
            with check (tenant_id = public.current_tenant_id() and public.is_admin());

drop trigger if exists stamp_tenant on public.sales_targets;
create trigger stamp_tenant before insert on public.sales_targets
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.sales_targets;
create trigger set_updated_at before update on public.sales_targets
  for each row execute function public.set_updated_at();
drop trigger if exists audit_sales_targets on public.sales_targets;
create trigger audit_sales_targets after insert or update or delete on public.sales_targets
  for each row execute function public.fn_audit();
