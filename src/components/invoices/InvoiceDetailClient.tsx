"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Invoice, InvoiceItem, DiscountType, InvoiceStatus } from "@/lib/types";
import {
  saveInvoiceHeader,
  saveInvoiceLine,
  addInvoiceLine,
  removeInvoiceLine,
  deleteInvoice,
  sendInvoiceEmail,
} from "@/app/(app)/invoices/actions";

// ── helpers ──────────────────────────────────────────────────────────────────

function money(n: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function invoiceNumber(n: number | null) {
  return n != null ? `INV-${String(n).padStart(5, "0")}` : "New Invoice";
}

function computeTotals(
  lines: EditLine[],
  discountType: DiscountType,
  discountValue: number,
) {
  const subtotal = lines.reduce(
    (s, l) => s + l.quantity * l.unit_price * (1 - l.discount / 100),
    0,
  );
  const taxAmount = lines.reduce(
    (s, l) =>
      s + l.quantity * l.unit_price * (1 - l.discount / 100) * (l.tax_rate / 100),
    0,
  );
  const discountAmount =
    discountType === "percent"
      ? subtotal * (discountValue / 100)
      : discountType === "amount"
        ? Math.min(discountValue, subtotal)
        : 0;
  const total = subtotal - discountAmount + taxAmount;
  return { subtotal, taxAmount, discountAmount, total };
}

// ── types ─────────────────────────────────────────────────────────────────────

type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  tax_rate: number;
};
type ContactPick = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};
interface EditLine extends InvoiceItem {
  _dirty?: boolean;
}

// ── constants ─────────────────────────────────────────────────────────────────

const LABEL = "block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1";
const INPUT = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50";
const SELECT = `${INPUT} bg-white`;

const INDIA_STATES = [
  { code: "01", name: "Jammu & Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra & Nagar Haveli and Daman & Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman & Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
];

function computeGst(taxAmount: number, placeOfSupply: string, sellerStateCode: string | null) {
  if (!placeOfSupply || !sellerStateCode) return { cgst: 0, sgst: 0, igst: taxAmount };
  if (placeOfSupply === sellerStateCode) {
    const half = Math.round((taxAmount / 2) * 100) / 100;
    return { cgst: half, sgst: Math.round((taxAmount - half) * 100) / 100, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: taxAmount };
}

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  sent:      "bg-blue-100 text-blue-700",
  overdue:   "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

// ── component ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailClient({
  invoice: initial,
  items: initialItems,
  products,
  accounts,
  contacts,
  deals,
  sellerGstin,
  sellerStateCode,
  canEdit,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  products: ProductPick[];
  accounts: { id: string; name: string }[];
  contacts: ContactPick[];
  deals: { id: string; name: string }[];
  sellerGstin: string | null;
  sellerStateCode: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const ro = !canEdit;

  // Header state
  const [title, setTitle] = useState(initial.title);
  const [status, setStatus] = useState<InvoiceStatus>(initial.status);
  const [invoiceDate, setInvoiceDate] = useState(initial.invoice_date?.slice(0, 10) ?? "");
  const [dueDate, setDueDate] = useState(initial.due_date?.slice(0, 10) ?? "");
  const [currency, setCurrency] = useState(initial.currency);
  const [accountId, setAccountId] = useState(initial.account_id ?? "");
  const [contactId, setContactId] = useState(initial.contact_id ?? "");
  const [dealId, setDealId] = useState(initial.deal_id ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(initial.discount_type);
  const [discountValue, setDiscountValue] = useState(initial.discount_value);
  const [paidAmount, setPaidAmount] = useState(initial.paid_amount);
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [terms, setTerms] = useState(initial.terms ?? "");
  const [customerGstin, setCustomerGstin] = useState(initial.customer_gstin ?? "");
  const [placeOfSupply, setPlaceOfSupply] = useState(initial.place_of_supply ?? "");

  // Line items state
  const [lines, setLines] = useState<EditLine[]>(initialItems);

  // UI state
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payInput, setPayInput] = useState(String(initial.paid_amount));
  const [addingProduct, setAddingProduct] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { subtotal, taxAmount, discountAmount, total } = computeTotals(lines, discountType, discountValue);
  const balance = total - paidAmount;
  const gst = computeGst(taxAmount, placeOfSupply, sellerStateCode);
  const isIntraState = placeOfSupply && sellerStateCode && placeOfSupply === sellerStateCode;

  // ── save header ─────────────────────────────────────────────────────────────

  const saveHeader = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await saveInvoiceHeader({
      id: initial.id,
      title,
      status,
      invoice_date: invoiceDate || undefined,
      due_date: dueDate || null,
      currency,
      account_id: accountId || null,
      contact_id: contactId || null,
      deal_id: dealId || null,
      discount_type: discountType,
      discount_value: discountValue,
      paid_amount: paidAmount,
      customer_gstin: customerGstin || null,
      place_of_supply: placeOfSupply || null,
      notes: notes || null,
      terms: terms || null,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Save failed.");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [
    initial.id, title, status, invoiceDate, dueDate, currency,
    accountId, contactId, dealId, discountType, discountValue,
    paidAmount, customerGstin, placeOfSupply, notes, terms,
  ]);

  // ── line operations ──────────────────────────────────────────────────────────

  async function saveLine(line: EditLine) {
    const res = await saveInvoiceLine({
      id: line.id,
      name: line.name,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount,
      tax_rate: line.tax_rate,
      hsn_sac: line.hsn_sac,
      position: line.position,
    });
    if (!res.ok) setError(res.error ?? "Line save failed.");
  }

  function updateLine(id: string, patch: Partial<EditLine>) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch, _dirty: true } : l)),
    );
  }

  async function addBlank() {
    const res = await addInvoiceLine(initial.id, { position: lines.length });
    if (!res.ok || !res.itemId) return setError(res.error ?? "Failed to add line.");
    setLines((prev) => [
      ...prev,
      {
        id: res.itemId!,
        tenant_id: initial.tenant_id,
        invoice_id: initial.id,
        product_id: null,
        name: "",
        description: null,
        quantity: 1,
        unit_price: 0,
        discount: 0,
        tax_rate: 0,
        hsn_sac: null,
        line_total: 0,
        position: prev.length,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  async function addProduct(p: ProductPick) {
    const res = await addInvoiceLine(initial.id, {
      product_id: p.id,
      name: p.name,
      unit_price: p.unit_price,
      tax_rate: p.tax_rate,
      position: lines.length,
    });
    if (!res.ok || !res.itemId) return setError(res.error ?? "Failed to add product.");
    setLines((prev) => [
      ...prev,
      {
        id: res.itemId!,
        tenant_id: initial.tenant_id,
        invoice_id: initial.id,
        product_id: p.id,
        name: p.name,
        description: p.description,
        quantity: 1,
        unit_price: p.unit_price,
        discount: 0,
        tax_rate: p.tax_rate,
        hsn_sac: null,
        line_total: p.unit_price * (1 + p.tax_rate / 100),
        position: prev.length,
        created_at: new Date().toISOString(),
      },
    ]);
    setAddingProduct(false);
  }

  async function removeLine(id: string) {
    const res = await removeInvoiceLine(id);
    if (!res.ok) return setError(res.error ?? "Failed to remove line.");
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  // ── record payment ───────────────────────────────────────────────────────────

  async function handleRecordPayment() {
    const amount = parseFloat(payInput);
    if (isNaN(amount) || amount < 0) return;
    const clamped = Math.min(amount, total);
    setPaidAmount(clamped);
    setShowPayModal(false);
    await saveInvoiceHeader({ id: initial.id, paid_amount: clamped });
    router.refresh();
  }

  // ── delete ───────────────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!confirm("Delete this invoice? This cannot be undone.")) return;
    const res = await deleteInvoice(initial.id);
    if (res.ok) router.push("/invoices");
    else setError(res.error ?? "Delete failed.");
  }

  // ── send email ───────────────────────────────────────────────────────────────

  async function handleSendEmail() {
    if (!confirm("Send this invoice by email to the linked contact?")) return;
    setSending(true);
    setError(null);
    const res = await sendInvoiceEmail(initial.id);
    setSending(false);
    if (!res.ok) return setError(res.error ?? "Failed to send email.");
    setSent(true);
    setStatus("sent");
    setTimeout(() => setSent(false), 3000);
  }

  // ── render ───────────────────────────────────────────────────────────────────

  const lineTotal = (l: EditLine) =>
    l.quantity * l.unit_price * (1 - l.discount / 100) * (1 + l.tax_rate / 100);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Invoices
        </button>
        <h1 className="text-xl font-bold text-slate-800">
          {invoiceNumber(initial.invoice_number)}
        </h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
          {status}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            initial.payment_status === "paid"
              ? "bg-green-100 text-green-700"
              : initial.payment_status === "partial"
                ? "bg-purple-100 text-purple-700"
                : "bg-amber-100 text-amber-700"
          }`}
        >
          {initial.payment_status}
        </span>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/invoices/${initial.id}/print`}
            target="_blank"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Print / PDF
          </Link>
          {canEdit && (
            <>
              <button
                onClick={handleSendEmail}
                disabled={sending}
                className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
              >
                {sending ? "Sending…" : sent ? "Sent ✓" : "Send Invoice"}
              </button>
              <button
                onClick={() => { setPayInput(String(paidAmount)); setShowPayModal(true); }}
                className="rounded-lg border border-green-300 px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50"
              >
                Record payment
              </button>
              <button
                onClick={saveHeader}
                disabled={busy}
                className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : saved ? "Saved ✓" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left: header fields */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={LABEL}>Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={ro}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className={LABEL}>Invoice Date</label>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={ro}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={ro}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="">— None —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL}>Contact</label>
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="">— None —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Deal</label>
                <select
                  value={dealId}
                  onChange={(e) => setDealId(e.target.value)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="">— None —</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {/* GST Fields */}
              <div>
                <label className={LABEL}>Customer GSTIN</label>
                <input
                  value={customerGstin}
                  onChange={(e) => setCustomerGstin(e.target.value.toUpperCase())}
                  disabled={ro}
                  placeholder="22AAAAA0000A1Z5"
                  maxLength={15}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Place of Supply</label>
                <select
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                  disabled={ro}
                  className={SELECT}
                >
                  <option value="">— Select state —</option>
                  {INDIA_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
                {placeOfSupply && sellerStateCode && (
                  <p className="mt-1 text-xs text-slate-400">
                    {isIntraState ? "Intra-state → CGST + SGST" : "Inter-state → IGST"}
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={ro}
                  rows={3}
                  className={INPUT}
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Terms</label>
                <textarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  disabled={ro}
                  rows={2}
                  className={INPUT}
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Line Items</h2>
              {!ro && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setAddingProduct(!addingProduct)}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    + From catalog
                  </button>
                  <button
                    onClick={addBlank}
                    className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    + Blank line
                  </button>
                </div>
              )}
            </div>

            {/* Product picker */}
            {addingProduct && (
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                <p className="mb-2 text-xs font-semibold text-slate-500">Select product</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {products.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand"
                    >
                      <span className="font-medium text-slate-700">{p.name}</span>
                      <span className="text-xs text-slate-400">{money(p.unit_price)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2 text-left">Item</th>
                    <th className="px-4 py-2 text-left">HSN/SAC</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Unit Price</th>
                    <th className="px-4 py-2 text-right">Disc %</th>
                    <th className="px-4 py-2 text-right">Tax %</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    {!ro && <th className="px-2 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-sm text-slate-400">
                        No line items. Add products or a blank line.
                      </td>
                    </tr>
                  )}
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-4 py-2">
                        <input
                          value={l.name}
                          onChange={(e) => updateLine(l.id, { name: e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          placeholder="Item name"
                          className="w-full rounded border border-transparent px-1 py-0.5 text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          value={l.hsn_sac ?? ""}
                          onChange={(e) => updateLine(l.id, { hsn_sac: e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          placeholder="HSN/SAC"
                          className="w-20 rounded border border-transparent px-1 py-0.5 text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.id, { quantity: +e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          className="w-16 rounded border border-transparent px-1 py-0.5 text-right text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          value={l.unit_price}
                          onChange={(e) => updateLine(l.id, { unit_price: +e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          className="w-24 rounded border border-transparent px-1 py-0.5 text-right text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={l.discount}
                          onChange={(e) => updateLine(l.id, { discount: +e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          className="w-16 rounded border border-transparent px-1 py-0.5 text-right text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={l.tax_rate}
                          onChange={(e) => updateLine(l.id, { tax_rate: +e.target.value })}
                          onBlur={() => l._dirty && saveLine(l)}
                          disabled={ro}
                          className="w-16 rounded border border-transparent px-1 py-0.5 text-right text-sm outline-none focus:border-brand disabled:bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium text-slate-700">
                        {money(lineTotal(l), currency)}
                      </td>
                      {!ro && (
                        <td className="px-2 py-2">
                          <button
                            onClick={() => removeLine(l.id)}
                            className="text-slate-300 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: totals + payment */}
        <div className="space-y-4">
          {/* Totals */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700">Summary</h2>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span>{money(subtotal, currency)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-slate-600">
                <span>Discount</span>
                <span className="text-red-600">−{money(discountAmount, currency)}</span>
              </div>
            )}
            {isIntraState ? (
              <>
                <div className="flex justify-between text-sm text-slate-600">
                  <span>CGST</span>
                  <span>{money(gst.cgst, currency)}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600">
                  <span>SGST</span>
                  <span>{money(gst.sgst, currency)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between text-sm text-slate-600">
                <span>{placeOfSupply && sellerStateCode ? "IGST" : "Tax"}</span>
                <span>{money(taxAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-bold text-slate-800">
              <span>Total</span>
              <span>{money(total, currency)}</span>
            </div>
            <div className="flex justify-between text-sm text-green-700">
              <span>Paid</span>
              <span>{money(paidAmount, currency)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-sm font-semibold text-slate-800">
              <span>Balance due</span>
              <span className={balance > 0 ? "text-amber-600" : "text-green-700"}>
                {money(balance, currency)}
              </span>
            </div>

            {/* Discount controls */}
            {!ro && (
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <label className={LABEL}>Header Discount</label>
                <div className="flex gap-2">
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as DiscountType)}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                  >
                    <option value="none">None</option>
                    <option value="percent">%</option>
                    <option value="amount">Fixed</option>
                  </select>
                  {discountType !== "none" && (
                    <input
                      type="number"
                      min={0}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(+e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Danger zone */}
          {canEdit && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="mb-2 text-xs font-semibold text-red-700">Danger zone</p>
              <button
                onClick={handleDelete}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                Delete invoice
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Record Payment Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-slate-800">Record Payment</h3>
            <p className="mb-1 text-xs text-slate-400">Invoice total: {money(total, currency)}</p>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Amount paid ({currency})</label>
            <input
              type="number"
              min={0}
              max={total}
              value={payInput}
              onChange={(e) => setPayInput(e.target.value)}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowPayModal(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordPayment}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                Save payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
