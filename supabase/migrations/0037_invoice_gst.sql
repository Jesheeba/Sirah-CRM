-- 0037 Invoice GST Compliance
-- Adds customer GSTIN, place of supply, CGST/SGST/IGST columns to invoices.
-- Adds HSN/SAC code column to invoice_items.
-- Adds seller GSTIN + state code to organization_branding (used for tax split logic).
-- Updates fn_recalc_invoice to split tax into CGST+SGST (intra-state) or IGST (inter-state).
-- Run after 0036. Idempotent.

-- ───────────────────────── invoices — new columns ─────────────────────────
alter table public.invoices
  add column if not exists customer_gstin   text,
  add column if not exists place_of_supply  text,          -- 2-digit state code e.g. '27'
  add column if not exists cgst             numeric(14,2) not null default 0,
  add column if not exists sgst             numeric(14,2) not null default 0,
  add column if not exists igst             numeric(14,2) not null default 0;

-- ───────────────────────── invoice_items — HSN/SAC ─────────────────────────
alter table public.invoice_items
  add column if not exists hsn_sac text;

-- ───────────────────────── organization_branding — seller GST info ─────────
alter table public.organization_branding
  add column if not exists seller_gstin      text,
  add column if not exists seller_state_code text;         -- 2-digit state code e.g. '27'

-- ───────────────────────── fn_recalc_invoice — GST-aware ──────────────────
-- Replaces the version in 0036. Splits tax_amount into CGST+SGST or IGST
-- based on whether place_of_supply matches the seller's state code.
create or replace function public.fn_recalc_invoice(p_inv uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_subtotal   numeric(14,2);
  v_tax        numeric(14,2);
  v_dtype      text;
  v_dvalue     numeric(14,2);
  v_damount    numeric(14,2);
  v_total      numeric(14,2);
  v_paid       numeric(14,2);
  v_pstatus    text;
  v_pos        text;      -- place_of_supply on the invoice
  v_seller_st  text;      -- seller_state_code from organization_branding
  v_tenant_id  uuid;
  v_cgst       numeric(14,2);
  v_sgst       numeric(14,2);
  v_igst       numeric(14,2);
begin
  -- Sum line item amounts
  select
    coalesce(sum(quantity * unit_price * (1 - discount / 100)), 0),
    coalesce(sum(quantity * unit_price * (1 - discount / 100) * tax_rate / 100), 0)
  into v_subtotal, v_tax
  from public.invoice_items
  where invoice_id = p_inv;

  -- Invoice header fields
  select
    discount_type,
    coalesce(discount_value, 0),
    coalesce(paid_amount, 0),
    place_of_supply,
    tenant_id
  into v_dtype, v_dvalue, v_paid, v_pos, v_tenant_id
  from public.invoices
  where id = p_inv;

  -- Seller state from org branding (may be null if not configured)
  select seller_state_code
  into v_seller_st
  from public.organization_branding
  where tenant_id = v_tenant_id;

  -- Discount
  v_damount := case
    when v_dtype = 'percent' then round(v_subtotal * v_dvalue / 100, 2)
    when v_dtype = 'amount'  then least(v_dvalue, v_subtotal)
    else 0
  end;

  v_total := round(v_subtotal - v_damount + v_tax, 2);

  -- Payment status
  v_pstatus := case
    when v_paid <= 0       then 'unpaid'
    when v_paid >= v_total then 'paid'
    else                        'partial'
  end;

  -- GST split: only when both place_of_supply and seller_state_code are set
  if v_pos is not null and v_seller_st is not null then
    if v_pos = v_seller_st then
      -- Intra-state: CGST + SGST (equal halves)
      v_cgst := round(v_tax / 2, 2);
      v_sgst := round(v_tax, 2) - v_cgst;   -- absorbs the rounding remainder
      v_igst := 0;
    else
      -- Inter-state: IGST only
      v_cgst := 0;
      v_sgst := 0;
      v_igst := round(v_tax, 2);
    end if;
  else
    -- No GST info configured — treat entire tax as IGST (backwards-compatible)
    v_cgst := 0;
    v_sgst := 0;
    v_igst := round(v_tax, 2);
  end if;

  update public.invoices
     set subtotal        = round(v_subtotal, 2),
         tax_amount      = round(v_tax, 2),
         discount_amount = round(v_damount, 2),
         total           = v_total,
         payment_status  = v_pstatus,
         cgst            = v_cgst,
         sgst            = v_sgst,
         igst            = v_igst
   where id = p_inv;
end; $$;

-- ───────────────────────── Trigger — also fire on place_of_supply change ───
-- Drop old trigger (only watched discount_type, discount_value, paid_amount)
-- and recreate with place_of_supply added so GST split recalculates immediately.
drop trigger if exists trg_inv_discount_recalc on public.invoices;
create trigger trg_inv_discount_recalc
  after update of discount_type, discount_value, paid_amount, place_of_supply
  on public.invoices
  for each row execute function public.fn_invoice_recalc();
