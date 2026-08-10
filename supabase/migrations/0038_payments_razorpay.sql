-- 0038 Payment Collection (Razorpay Payment Links)
-- Adds:
--   1. 'razorpay' as an integration_settings channel (per-tenant key_id/key_secret/webhook_secret)
--   2. payments table — one row per Payment Link generated against an invoice
--   3. payment_webhook_events — replay-guard ledger for inbound Razorpay webhooks
--   4. fn_record_payment_captured() — the ONLY way a payment can be marked paid; webhook-only
-- Run after 0001-0037. Idempotent.

-- ───────────────────────── 1. integration_settings — razorpay channel ─────────────────────────
ALTER TABLE public.integration_settings
  DROP CONSTRAINT IF EXISTS integration_settings_channel_check;

ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_channel_check
    CHECK (channel IN ('email', 'whatsapp', 'sms', 'whatsapp_device', 'razorpay'));

-- razorpay_key_id: not a secret (it's the public identifier used client-side by every
--   Razorpay integration) — readable by tenant members, same tier as phone_id.
-- webhook_secret: SECRET — verifies inbound webhook signatures. Service-role only.
-- access_token (existing column, reused): stores the Razorpay key_secret for this channel.
ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS razorpay_key_id text,
  ADD COLUMN IF NOT EXISTS webhook_secret  text;

GRANT SELECT (razorpay_key_id) ON public.integration_settings TO authenticated;
GRANT UPDATE (razorpay_key_id) ON public.integration_settings TO authenticated;
GRANT INSERT (razorpay_key_id) ON public.integration_settings TO authenticated;
-- webhook_secret intentionally NOT granted to anon/authenticated — service_role only,
-- same column-privilege pattern as access_token / webhook_token (see 0021, 0030).

-- ───────────────────────── 2. payments ─────────────────────────
create table if not exists public.payments (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  invoice_id                uuid not null references public.invoices(id) on delete cascade,
  provider                  text not null default 'razorpay' check (provider in ('razorpay')),
  amount                    numeric(14,2) not null check (amount > 0),
  currency                  text not null default 'INR',
  method                    text,                        -- card|upi|netbanking|wallet|emi (set on capture)
  status                    text not null default 'created'
                            check (status in ('created','paid','failed','cancelled','expired')),
  razorpay_payment_link_id  text,
  razorpay_payment_id       text,
  short_url                 text,
  failure_reason            text,
  paid_at                   timestamptz,
  created_by                uuid not null default auth.uid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index if not exists payments_link_uk
  on public.payments (razorpay_payment_link_id) where razorpay_payment_link_id is not null;
create unique index if not exists payments_payment_uk
  on public.payments (razorpay_payment_id) where razorpay_payment_id is not null;
create index if not exists payments_invoice_idx on public.payments (invoice_id, created_at desc);
create index if not exists payments_tenant_status_idx on public.payments (tenant_id, status);

drop trigger if exists stamp_tenant on public.payments;
create trigger stamp_tenant before insert on public.payments
  for each row execute function public.fn_stamp_tenant();
drop trigger if exists set_updated_at on public.payments;
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
drop trigger if exists audit_payments on public.payments;
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function public.fn_audit();

alter table public.payments enable row level security;

drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments
  for select using (tenant_id = public.current_tenant_id());

-- Only the invoice's owner or an Admin/Manager may create a payment link for it.
-- Marking a payment 'paid' happens exclusively through fn_record_payment_captured()
-- (security definer, service-role-only execute) — this policy never authorizes that transition.
drop policy if exists payments_write on public.payments;
create policy payments_write on public.payments
  for all
  using (tenant_id = public.current_tenant_id()
         and (created_by = auth.uid() or public.current_user_role() in ('Admin','Manager')))
  with check (tenant_id = public.current_tenant_id()
         and (created_by = auth.uid() or public.current_user_role() in ('Admin','Manager')));

-- ───────────────────────── 3. payment_webhook_events — replay guard ─────────────────────────
-- No tenant scoping (a webhook arrives before we know which tenant it belongs to) and no
-- client access at all — only the service-role webhook handler ever touches this table.
create table if not exists public.payment_webhook_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'razorpay',
  event_id     text not null,
  event_type   text,
  received_at  timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.payment_webhook_events enable row level security;
revoke all on public.payment_webhook_events from anon;
revoke all on public.payment_webhook_events from authenticated;
grant all on public.payment_webhook_events to service_role;

-- ───────────────────────── 4. fn_record_payment_captured — webhook-only transition ─────────
-- Idempotent: only transitions a payments row that is not already 'paid', so a retried
-- webhook delivery (Razorpay retries non-2xx responses) or a duplicate event is a safe no-op.
-- Bumps invoices.paid_amount, which fires the existing recalc trigger (0036/0037) to derive
-- payment_status. Notifies the invoice owner (respects notification_preferences via
-- fn_should_notify, same gate as deal_won / quote_accepted in 0017).
create or replace function public.fn_record_payment_captured(
  p_razorpay_payment_link_id text,
  p_razorpay_payment_id      text,
  p_amount                   numeric,
  p_method                   text,
  p_paid_at                  timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_payment_id  uuid;
  v_invoice_id  uuid;
  v_owner       uuid;
  v_invnum      int;
begin
  update public.payments
     set status              = 'paid',
         razorpay_payment_id = p_razorpay_payment_id,
         method              = coalesce(p_method, method),
         paid_at             = p_paid_at,
         updated_at          = now()
   where razorpay_payment_link_id = p_razorpay_payment_link_id
     and status <> 'paid'
  returning id, invoice_id into v_payment_id, v_invoice_id;

  if v_payment_id is null then
    return; -- unknown link, or already processed — no-op
  end if;

  update public.invoices
     set paid_amount = least(total, paid_amount + p_amount)
   where id = v_invoice_id
  returning owner_id, invoice_number into v_owner, v_invnum;

  if v_owner is not null and public.fn_should_notify(v_owner, 'invoice_paid') then
    insert into public.notifications(tenant_id, user_id, type, title, link, entity_type, entity_id)
    select tenant_id, v_owner, 'invoice_paid',
           'Payment received: INV-' || lpad(coalesce(v_invnum, 0)::text, 5, '0'),
           '/invoices/' || v_invoice_id, 'invoice', v_invoice_id
    from public.invoices where id = v_invoice_id;
  end if;
end; $$;

-- SECURITY: this function marks money as received. It must be reachable ONLY from the
-- Razorpay webhook handler (which calls it via the service-role client) — never as a
-- client-callable RPC, or any authenticated user could invoke it to mark any invoice paid.
revoke execute on function public.fn_record_payment_captured(text, text, numeric, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fn_record_payment_captured(text, text, numeric, text, timestamptz)
  to service_role;
