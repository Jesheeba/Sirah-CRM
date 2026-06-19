-- 0013 Quotations (Phase 5): sales quotes with line items, taxes, discounts.
-- Totals are computed in-database (triggers) so the list, editor and PDF never drift.
-- Integrates with deals/accounts/contacts (links) and products (line items).
-- Run after 0001-0012. Idempotent.

-- ───────────────────────── Tables ─────────────────────────
create table if not exists public.quotations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  quote_number    int,                                   -- assigned per-tenant by trigger
  title           text not null default 'Quotation',
  status          text not null default 'draft'
                  check (status in ('draft','sent','accepted','rejected','expired')),
  deal_id         uuid references public.deals(id)    on delete set null,
  account_id      uuid references public.accounts(id) on delete set null,
  contact_id      uuid references public.contacts(id) on delete set null,
  currency        text not null default 'INR',
  valid_until     date,
  -- header-level discount applied on the subtotal (line nets)
  discount_type   text not null default 'none' check (discount_type in ('none','percent','amount')),
  discount_value  numeric(14,2) not null default 0,
  -- derived totals (maintained by fn_recalc_quotation)
  subtotal        numeric(14,2) not null default 0,      -- Σ line nets (after line discounts, before tax)
  discount_amount numeric(14,2) not null default 0,      -- header discount in currency
  tax_amount      numeric(14,2) not null default 0,      -- Σ line taxes
  total           numeric(14,2) not null default 0,      -- subtotal - discount_amount + tax_amount
  notes           text,
  terms           text,
  owner_id        uuid not null default auth.uid(),
  custom_fields   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (tenant_id, quote_number)
);
create index if not exists quotations_tenant_status_idx on public.quotations (tenant_id, status);
create index if not exists quotations_deal_idx          on public.quotations (tenant_id, deal_id);

create table if not exists public.quotation_items (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  quotation_id  uuid not null references public.quotations(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  name          text not null,
  description   text,
  quantity      numeric(14,2) not null default 1,
  unit_price    numeric(14,2) not null default 0,
  discount      numeric(5,2)  not null default 0,        -- line discount %
  tax_rate      numeric(5,2)  not null default 0,        -- line tax %
  line_total    numeric(14,2) generated always as
                (round(quantity * unit_price * (1 - discount / 100) * (1 + tax_rate / 100), 2)) stored,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists quotation_items_quote_idx on public.quotation_items (quotation_id, position);

-- ───────────────────────── Totals engine ─────────────────────────
-- Single source of truth for header totals. Calc model (documented):
--   line_net = qty * unit_price * (1 - line_discount/100)
--   line_tax = line_net * tax_rate/100
--   subtotal = Σ line_net ; tax_amount = Σ line_tax
--   discount_amount = header discount on subtotal (percent or fixed, capped at subtotal)
--   total = subtotal - discount_amount + tax_amount
create or replace function public.fn_recalc_quotation(p_quote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_subtotal numeric(14,2);
  v_tax      numeric(14,2);
  v_dtype    text;
  v_dvalue   numeric(14,2);
  v_damount  numeric(14,2);
begin
  select coalesce(sum(quantity * unit_price * (1 - discount / 100)), 0),
         coalesce(sum(quantity * unit_price * (1 - discount / 100) * tax_rate / 100), 0)
    into v_subtotal, v_tax
  from public.quotation_items
  where quotation_id = p_quote;

  select discount_type, coalesce(discount_value, 0)
    into v_dtype, v_dvalue
  from public.quotations
  where id = p_quote;

  v_damount := case
    when v_dtype = 'percent' then round(v_subtotal * v_dvalue / 100, 2)
    when v_dtype = 'amount'  then least(v_dvalue, v_subtotal)
    else 0
  end;

  update public.quotations
     set subtotal        = round(v_subtotal, 2),
         tax_amount      = round(v_tax, 2),
         discount_amount = round(v_damount, 2),
         total           = round(v_subtotal - v_damount + v_tax, 2)
   where id = p_quote;
end; $$;

-- Recalc parent whenever its items change.
create or replace function public.fn_quotation_items_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_recalc_quotation(coalesce(new.quotation_id, old.quotation_id));
  return null;
end; $$;

-- Recalc self when the header discount changes. Column-scoped trigger: fn_recalc
-- only writes the derived columns, so this never recurses.
create or replace function public.fn_quotation_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fn_recalc_quotation(new.id);
  return null;
end; $$;

-- Per-tenant sequential quote number. Runs after stamp_tenant (alpha order) so
-- tenant_id is set; falls back to current_tenant_id() defensively.
create or replace function public.fn_assign_quote_number()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_tenant uuid; v_next int;
begin
  if new.quote_number is null then
    v_tenant := coalesce(new.tenant_id, public.current_tenant_id());
    select coalesce(max(quote_number), 0) + 1 into v_next
    from public.quotations where tenant_id = v_tenant;
    new.quote_number := v_next;
  end if;
  return new;
end; $$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.quotations      enable row level security;
alter table public.quotation_items enable row level security;

-- Quotations: read = any tenant member; write = owner or Admin/Manager.
drop policy if exists q_read on public.quotations;
create policy q_read on public.quotations
  for select using (tenant_id = public.current_tenant_id());
drop policy if exists q_write on public.quotations;
create policy q_write on public.quotations
  for all
  using (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager')));

-- Items inherit access from their parent quotation.
drop policy if exists qi_read on public.quotation_items;
create policy qi_read on public.quotation_items
  for select using (exists (
    select 1 from public.quotations q
    where q.id = quotation_id and q.tenant_id = public.current_tenant_id()));
drop policy if exists qi_write on public.quotation_items;
create policy qi_write on public.quotation_items
  for all
  using (exists (
    select 1 from public.quotations q
    where q.id = quotation_id and q.tenant_id = public.current_tenant_id()
      and (q.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))))
  with check (exists (
    select 1 from public.quotations q
    where q.id = quotation_id and q.tenant_id = public.current_tenant_id()
      and (q.owner_id = auth.uid() or public.current_user_role() in ('Admin','Manager'))));

-- ───────────────────────── Triggers ─────────────────────────
drop trigger if exists stamp_tenant on public.quotations;
create trigger stamp_tenant before insert on public.quotations
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists stamp_tenant on public.quotation_items;
create trigger stamp_tenant before insert on public.quotation_items
  for each row execute function public.fn_stamp_tenant();

drop trigger if exists trg_assign_quote_number on public.quotations;
create trigger trg_assign_quote_number before insert on public.quotations
  for each row execute function public.fn_assign_quote_number();

drop trigger if exists set_updated_at on public.quotations;
create trigger set_updated_at before update on public.quotations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_items_recalc on public.quotation_items;
create trigger trg_items_recalc after insert or update or delete on public.quotation_items
  for each row execute function public.fn_quotation_items_recalc();

drop trigger if exists trg_quote_discount_recalc on public.quotations;
create trigger trg_quote_discount_recalc after update of discount_type, discount_value on public.quotations
  for each row execute function public.fn_quotation_recalc();

drop trigger if exists audit_quotations on public.quotations;
create trigger audit_quotations after insert or update or delete on public.quotations
  for each row execute function public.fn_audit();
drop trigger if exists audit_quotation_items on public.quotation_items;
create trigger audit_quotation_items after insert or update or delete on public.quotation_items
  for each row execute function public.fn_audit();
