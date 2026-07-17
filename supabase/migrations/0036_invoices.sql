-- 0036 Invoices: sales invoices with line items, payment tracking, quotation link.
-- Mirrors the quotation engine (0013) with added payment_status + paid_amount columns.
-- Run after 0001-0035. Idempotent.

-- ───────────────────────── Tables ─────────────────────────
create table if not exists public.invoices (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  invoice_number   int,                                   -- assigned per-tenant by trigger
  title            text not null default 'Invoice',
  status           text not null default 'draft'
                   check (status in ('draft','sent','overdue','cancelled')),
  payment_status   text not null default 'unpaid'
                   check (payment_status in ('unpaid','partial','paid')),
  quotation_id     uuid references public.quotations(id) on delete set null,
  deal_id          uuid references public.deals(id)    on delete set null,
  account_id       uuid references public.accounts(id) on delete set null,
  contact_id       uuid references public.contacts(id) on delete set null,
  currency         text not null default 'INR',
  invoice_date     date not null default current_date,
  due_date         date,
  discount_type    text not null default 'none' check (discount_type in ('none','percent','amount')),
  discount_value   numeric(14,2) not null default 0,
  subtotal         numeric(14,2) not null default 0,
  discount_amount  numeric(14,2) not null default 0,
  tax_amount       numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0,
  paid_amount      numeric(14,2) not null default 0,
  notes            text,
  terms            text,
  owner_id         uuid not null default auth.uid(),
  custom_fields    jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (tenant_id, invoice_number)
);
create index if not exists invoices_tenant_status_idx on public.invoices (tenant_id, status);
create index if not exists invoices_account_idx       on public.invoices (tenant_id, account_id);
create index if not exists invoices_quotation_idx     on public.invoices (quotation_id) where quotation_id is not null;

create table if not exists public.invoice_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  name         text not null,
  description  text,
  quantity     numeric(14,2) not null default 1,
  unit_price   numeric(14,2) not null default 0,
  discount     numeric(5,2)  not null default 0,
  tax_rate     numeric(5,2)  not null default 0,
  line_total   numeric(14,2) generated always as
               (round(quantity * unit_price * (1 - discount / 100) * (1 + tax_rate / 100), 2)) stored,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- ───────────────────────── Totals engine ─────────────────────────
create or replace function public.fn_recalc_invoice(p_inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_subtotal numeric(14,2);
  v_tax      numeric(14,2);
  v_dtype    text;
  v_dvalue   numeric(14,2);
  v_damount  numeric(14,2);
  v_total    numeric(14,2);
  v_paid     numeric(14,2);
  v_pstatus  text;
begin
  select coalesce(sum(quantity * unit_price * (1 - discount / 100)), 0),
         coalesce(sum(quantity * unit_price * (1 - discount / 100) * tax_rate / 100), 0)
    into v_subtotal, v_tax
  from public.invoice_items
  where invoice_id = p_inv;

  select discount_type, coalesce(discount_value, 0), coalesce(paid_amount, 0)
    into v_dtype, v_dvalue, v_paid
  from public.invoices
  where id = p_inv;

  v_damount := case
    when v_dtype = 'percent' then round(v_subtotal * v_dvalue / 100, 2)
    when v_dtype = 'amount'  then least(v_dvalue, v_subtotal)
    else 0
  end;

  v_total := round(v_subtotal - v_damount + v_tax, 2);

  v_pstatus := case
    when v_paid <= 0           then 'unpaid'
    when v_paid >= v_total     then 'paid'
    else                            'partial'
  end;

  update public.invoices
     set subtotal        = round(v_subtotal, 2),
         tax_amount      = round(v_tax, 2),
         discount_amount = round(v_damount, 2),
         total           = v_total,
         payment_status  = v_pstatus
   where id = p_inv;
end; $$;

create or replace function public.fn_invoice_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end; $$;

create or replace function public.fn_invoice_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_recalc_invoice(new.id);
  return null;
end; $$;

-- Per-tenant sequential invoice number.
create or replace function public.fn_assign_invoice_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_next int;
begin
  if new.invoice_number is null then
    v_tenant := coalesce(new.tenant_id, public.current_tenant_id());
    select coalesce(max(invoice_number), 0) + 1 into v_next
    from public.invoices where tenant_id = v_tenant;
    new.invoice_number := v_next;
  end if;
  return new;
end; $$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists inv_read  on public.invoices;
create policy inv_read on public.invoices
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists inv_write on public.invoices;
create policy inv_write on public.invoices
  for all
  using (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

drop policy if exists invitem_read  on public.invoice_items;
create policy invitem_read on public.invoice_items
  for select using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.tenant_id = public.current_tenant_id()));

drop policy if exists invitem_write on public.invoice_items;
create policy invitem_write on public.invoice_items
  for all
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.tenant_id = public.current_tenant_id()
      and (i.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))))
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_id and i.tenant_id = public.current_tenant_id()
      and (i.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))));

-- ───────────────────────── Triggers ─────────────────────────
drop trigger if exists stamp_tenant on public.invoices;
create trigger stamp_tenant before insert on public.invoices
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists stamp_tenant on public.invoice_items;
create trigger stamp_tenant before insert on public.invoice_items
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists trg_assign_invoice_number on public.invoices;
create trigger trg_assign_invoice_number before insert on public.invoices
  for each row execute function public.fn_assign_invoice_number();

drop trigger if exists set_updated_at on public.invoices;
create trigger set_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists trg_inv_items_recalc on public.invoice_items;
create trigger trg_inv_items_recalc after insert or update or delete on public.invoice_items
  for each row execute function public.fn_invoice_items_recalc();

drop trigger if exists trg_inv_discount_recalc on public.invoices;
create trigger trg_inv_discount_recalc after update of discount_type, discount_value, paid_amount on public.invoices
  for each row execute function public.fn_invoice_recalc();

drop trigger if exists audit_invoices on public.invoices;
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function public.fn_audit();

drop trigger if exists audit_invoice_items on public.invoice_items;
create trigger audit_invoice_items after insert or update or delete on public.invoice_items
  for each row execute function public.fn_audit();
