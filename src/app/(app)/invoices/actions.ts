"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { resolveEmailConfig } from "@/lib/integrations";
import { resolveRazorpayConfig, razorpayAuthHeader } from "@/lib/payments";
import type { DiscountType, Payment } from "@/lib/types";

type SaveResult = { ok: boolean; error?: string; id?: string };

// ── Create ────────────────────────────────────────────────────────────────────

export async function createInvoice(opts?: {
  quotation_id?: string;
  account_id?: string;
  deal_id?: string;
  contact_id?: string;
  title?: string;
}): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      title: opts?.title ?? "Invoice",
      quotation_id: opts?.quotation_id ?? null,
      account_id: opts?.account_id ?? null,
      deal_id: opts?.deal_id ?? null,
      contact_id: opts?.contact_id ?? null,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create invoice." };
  revalidatePath("/invoices");
  return { ok: true, id: data.id };
}

// ── Create from Quotation ─────────────────────────────────────────────────────

export async function createInvoiceFromQuotation(
  quotationId: string,
): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const supabase = await createClient();

  const { data: q, error: qErr } = await supabase
    .from("quotations")
    .select("*, quotation_items(*)")
    .eq("id", quotationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (qErr || !q) return { ok: false, error: "Quotation not found." };

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .insert({
      title: q.title,
      quotation_id: quotationId,
      account_id: q.account_id,
      deal_id: q.deal_id,
      contact_id: q.contact_id,
      currency: q.currency,
      discount_type: q.discount_type,
      discount_value: q.discount_value,
      notes: q.notes,
      terms: q.terms,
    })
    .select("id")
    .single();

  if (invErr || !inv) return { ok: false, error: invErr?.message ?? "Could not create invoice." };

  const items = (q.quotation_items ?? []).map(
    (item: {
      product_id: string | null;
      name: string;
      description: string | null;
      quantity: number;
      unit_price: number;
      discount: number;
      tax_rate: number;
      position: number;
    }, i: number) => ({
      invoice_id: inv.id,
      product_id: item.product_id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount: item.discount,
      tax_rate: item.tax_rate,
      position: i,
    }),
  );

  if (items.length > 0) {
    const { error: itemErr } = await supabase.from("invoice_items").insert(items);
    if (itemErr) return { ok: false, error: itemErr.message };
  }

  revalidatePath("/invoices");
  return { ok: true, id: inv.id };
}

// ── Save Header ───────────────────────────────────────────────────────────────

export interface SaveInvoiceHeaderInput {
  id: string;
  title?: string;
  status?: string;
  invoice_date?: string;
  due_date?: string | null;
  currency?: string;
  account_id?: string | null;
  contact_id?: string | null;
  deal_id?: string | null;
  discount_type?: DiscountType;
  discount_value?: number;
  paid_amount?: number;
  customer_gstin?: string | null;
  place_of_supply?: string | null;
  notes?: string | null;
  terms?: string | null;
}

export async function saveInvoiceHeader(
  input: SaveInvoiceHeaderInput,
): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const { id, ...rest } = input;
  const supabase = await createClient();
  const { error } = await supabase.from("invoices").update(rest).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/invoices/${id}`);
  revalidatePath("/invoices");
  return { ok: true };
}

// ── Line items ────────────────────────────────────────────────────────────────

export interface SaveInvoiceLineInput {
  id: string;
  name?: string;
  description?: string | null;
  quantity?: number;
  unit_price?: number;
  discount?: number;
  tax_rate?: number;
  hsn_sac?: string | null;
  position?: number;
}

export async function saveInvoiceLine(
  input: SaveInvoiceLineInput,
): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const { id, ...rest } = input;
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_items").update(rest).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function addInvoiceLine(
  invoiceId: string,
  opts?: { product_id?: string; name?: string; unit_price?: number; tax_rate?: number; position?: number },
): Promise<SaveResult & { itemId?: string }> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice_items")
    .insert({
      invoice_id: invoiceId,
      product_id: opts?.product_id ?? null,
      name: opts?.name ?? "",
      unit_price: opts?.unit_price ?? 0,
      tax_rate: opts?.tax_rate ?? 0,
      position: opts?.position ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not add line." };
  return { ok: true, itemId: data.id };
}

export async function removeInvoiceLine(itemId: string): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const supabase = await createClient();
  const { error } = await supabase.from("invoice_items").delete().eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Send Invoice Email ────────────────────────────────────────────────────────

export async function sendInvoiceEmail(invoiceId: string): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, contacts(first_name, last_name, email), accounts(name)")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!inv) return { ok: false, error: "Invoice not found." };

  const toEmail = (inv.contacts as { first_name: string | null; last_name: string | null; email: string | null } | null)?.email;
  if (!toEmail) return { ok: false, error: "No email address on the linked contact. Add an email to the contact first." };

  const cfg = await resolveEmailConfig(ctx.tenantId);
  if (cfg.mode === "link" || !cfg.apiKey || !cfg.fromEmail) {
    return { ok: false, error: "Email provider not configured. Go to Settings → Integrations → Email to set it up." };
  }

  const invNum = inv.invoice_number != null
    ? `INV-${String(inv.invoice_number).padStart(5, "0")}`
    : "Invoice";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const printUrl = `${appUrl}/invoices/${invoiceId}/print`;
  const firstName = (inv.contacts as { first_name: string | null } | null)?.first_name ?? "";
  const total = new Intl.NumberFormat("en-IN", { style: "currency", currency: inv.currency ?? "INR" }).format(Number(inv.total));
  const dueDate = inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-IN") : "—";

  const subject = `${invNum} from ${ctx.tenantName}`;
  const textBody = [
    `Hi ${firstName || "there"},`,
    ``,
    `Please find your invoice ${invNum} from ${ctx.tenantName}.`,
    ``,
    `Amount due: ${total}`,
    `Due date: ${dueDate}`,
    ``,
    `View & download invoice: ${printUrl}`,
    ``,
    `Thank you,`,
    ctx.tenantName,
  ].join("\n");

  const htmlBody = textBody
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>")
    .replace(printUrl, `<a href="${printUrl}">${printUrl}</a>`);

  const fromHeader = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromHeader, to: [toEmail], subject, text: textBody, html: htmlBody }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, error: json.message ?? `Email failed (${res.status})` };
  }

  await supabase.from("invoices").update({ status: "sent" }).eq("id", invoiceId);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { ok: true };
}

// ── Collect Payment (Razorpay Payment Link) ───────────────────────────────────

type PaymentLinkResult = { ok: boolean; error?: string; payment?: Payment };

/**
 * Creates a Razorpay Payment Link for an invoice's outstanding balance and stores it as
 * a `payments` row (status='created'). The link is NOT auto-shared — the rep copies it
 * from the invoice detail page and sends it however they choose (email, WhatsApp, etc).
 *
 * The invoice is only ever marked paid by the webhook (fn_record_payment_captured),
 * never by this action — this action only ever creates a pending payment attempt.
 */
export async function createPaymentLink(invoiceId: string): Promise<PaymentLinkResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("id, invoice_number, title, total, paid_amount, currency, owner_id, contacts(first_name, last_name, email, phone)")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!inv) return { ok: false, error: "Invoice not found." };

  const canEdit = ctx.isAdmin || ctx.isManager || inv.owner_id === ctx.userId;
  if (!canEdit) return { ok: false, error: "You don't have permission to collect payment on this invoice." };

  const balance = Math.round((Number(inv.total) - Number(inv.paid_amount)) * 100) / 100;
  if (balance <= 0) return { ok: false, error: "This invoice has no outstanding balance." };

  const cfg = await resolveRazorpayConfig(ctx.tenantId);
  if (cfg.mode === "none" || !cfg.keyId || !cfg.keySecret) {
    return { ok: false, error: "Razorpay is not configured. Go to Settings → Integrations → Razorpay to set it up." };
  }

  const invNum = inv.invoice_number != null
    ? `INV-${String(inv.invoice_number).padStart(5, "0")}`
    : "Invoice";
  const contact = inv.contacts as unknown as { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  const customerName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || undefined;

  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: razorpayAuthHeader(cfg.keyId, cfg.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(balance * 100), // smallest currency unit
      currency: inv.currency ?? "INR",
      description: `${invNum} — ${inv.title}`,
      customer: {
        ...(customerName ? { name: customerName } : {}),
        ...(contact?.email ? { email: contact.email } : {}),
        ...(contact?.phone ? { contact: contact.phone } : {}),
      },
      notify: { sms: false, email: false }, // the rep shares the link manually
      reminder_enable: false,
      reference_id: invoiceId,
      notes: { invoice_id: invoiceId, tenant_id: ctx.tenantId },
      callback_url: `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}/invoices/${invoiceId}`,
      callback_method: "get",
    }),
  });

  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    return { ok: false, error: json.error?.description ?? `Razorpay request failed (${res.status})` };
  }

  const link = (await res.json()) as { id: string; short_url: string };

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      invoice_id: invoiceId,
      amount: balance,
      currency: inv.currency ?? "INR",
      razorpay_payment_link_id: link.id,
      short_url: link.short_url,
      status: "created",
    })
    .select("*")
    .single();

  if (error || !payment) return { ok: false, error: error?.message ?? "Payment link created but could not be saved." };

  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, payment: payment as Payment };
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteInvoice(id: string): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin && !ctx.isManager)
    return { ok: false, error: "Only Admins and Managers can delete invoices." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/invoices");
  return { ok: true };
}
