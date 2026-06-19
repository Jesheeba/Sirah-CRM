-- 0012 Products: a tenant product catalog (Phase 4). Foundation for Quotations.
-- Read by everyone in the tenant; managed by Admin/Manager. Run after 0001-0011. Idempotent.

create table if not exists public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists product_categories_idx on public.product_categories (tenant_id);

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  sku           text,
  description   text,
  category_id   uuid references public.product_categories(id) on delete set null,
  unit_price    numeric(14,2) not null default 0,
  currency      text not null default 'INR',
  tax_rate      numeric(5,2) not null default 0,
  status        text not null default 'active' check (status in ('active','inactive','archived')),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists products_tenant_status_idx on public.products (tenant_id, status);

alter table public.product_categories enable row level security;
alter table public.products           enable row level security;

-- Read = any tenant member; write = Admin/Manager (catalog management).
drop policy if exists pc_read on public.product_categories;
create policy pc_read on public.product_categories
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists pc_write on public.product_categories;
create policy pc_write on public.product_categories
  for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'))
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'));

drop policy if exists prod_read on public.products;
create policy prod_read on public.products
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists prod_write on public.products;
create policy prod_write on public.products
  for all
  using (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'))
  with check (tenant_id = public.current_tenant_id() and public.current_user_role() in ('Admin','Manager'));

-- Tenant stamping + updated_at + audit (catalog changes are audited).
drop trigger if exists stamp_tenant on public.product_categories;
create trigger stamp_tenant before insert on public.product_categories
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.products;
create trigger stamp_tenant before insert on public.products
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists set_updated_at on public.products;
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.fn_audit();
