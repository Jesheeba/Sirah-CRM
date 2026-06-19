"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/reports";
import { computeTotals, lineTotal, quoteNumber, QUOTE_STATUS_STYLE } from "@/lib/quotations";
import {
  DISCOUNT_TYPES,
  QUOTATION_STATUSES,
  type DiscountType,
  type Quotation,
  type QuotationItem,
  type QuotationStatus,
} from "@/lib/types";

type ProductPick = {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  unit_price: number;
  tax_rate: number;
};
type ContactPick = { id: string; first_name: string | null; last_name: string | null; email: string | null };

interface EditLine {
  id: string;
  product_id: string | null;
  name: string;
  description: string;
  quantity: string;
  unit_price: string;
  discount: string;
  tax_rate: string;
}

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT =
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50 disabled:text-slate-500";
const CELL =
  "w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-brand disabled:bg-transparent disabled:border-transparent";

const toEdit = (i: QuotationItem): EditLine => ({
  id: i.id,
  product_id: i.product_id,
  name: i.name,
  description: i.description ?? "",
  quantity: String(i.quantity ?? 1),
  unit_price: String(i.unit_price ?? 0),
  discount: String(i.discount ?? 0),
  tax_rate: String(i.tax_rate ?? 0),
});

const contactName = (c: ContactPick) =>
  `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)";

export default function QuotationDetailClient({
  quotation,
  items,
  products,
  accounts,
  contacts,
  deals,
  canEdit,
}: {
  quotation: Quotation;
  items: QuotationItem[];
  products: ProductPick[];
  accounts: { id: string; name: string }[];
  contacts: ContactPick[];
  deals: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const ro = !canEdit;

  // header
  const [title, setTitle] = useState(quotation.title);
  const [status, setStatus] = useState<QuotationStatus>(quotation.status);
  const [currency, setCurrency] = useState(quotation.currency);
  const [validUntil, setValidUntil] = useState(quotation.valid_until ?? "");
  const [accountId, setAccountId] = useState(quotation.account_id ?? "");
  const [contactId, setContactId] = useState(quotation.contact_id ?? "");
  const [dealId, setDealId] = useState(quotation.deal_id ?? "");
  const [discountType, setDiscountType] = useState<DiscountType>(quotation.discount_type);
  const [discountValue, setDiscountValue] = useState(String(quotation.discount_value ?? 0));
  const [notes, setNotes] = useState(quotation.notes ?? "");
  const [terms, setTerms] = useState(quotation.terms ?? "");

  // lines
  const [lines, setLines] = useState<EditLine[]>(items.map(toEdit));
  const [picker, setPicker] = useState("");

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = computeTotals(lines, discountType, discountValue);

  function patchLine(id: string, patch: Partial<EditLine>) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  async function saveLine(id: string) {
    const l = lines.find((x) => x.id === id);
    if (!l) return;
    const { error } = await supabase
      .from("quotation_items")
      .update({
        name: l.name.trim() || "Item",
        description: l.description.trim() || null,
        product_id: l.product_id,
        quantity: Number(l.quantity) || 0,
        unit_price: Number(l.unit_price) || 0,
        discount: Number(l.discount) || 0,
        tax_rate: Number(l.tax_rate) || 0,
      })
      .eq("id", id);
    if (error) setError(error.message);
  }

  async function addBlank() {
    setError(null);
    const { data, error } = await supabase
      .from("quotation_items")
      .insert({ quotation_id: quotation.id, name: "New item", quantity: 1, unit_price: 0, position: lines.length })
      .select("*")
      .single();
    if (error) return setError(error.message);
    setLines((ls) => [...ls, toEdit(data as QuotationItem)]);
  }

  async function addProduct(productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setError(null);
    const { data, error } = await supabase
      .from("quotation_items")
      .insert({
        quotation_id: quotation.id,
        product_id: p.id,
        name: p.name,
        description: p.description,
        quantity: 1,
        unit_price: p.unit_price,
        tax_rate: p.tax_rate,
        position: lines.length,
      })
      .select("*")
      .single();
    if (error) return setError(error.message);
    setLines((ls) => [...ls, toEdit(data as QuotationItem)]);
    setPicker("");
  }

  async function removeLine(id: string) {
    setError(null);
    const prev = lines;
    setLines((ls) => ls.filter((l) => l.id !== id));
    const { error } = await supabase.from("quotation_items").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setLines(prev);
    }
  }

  async function saveHeader() {
    if (!title.trim()) return setError("Title is required.");
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("quotations")
      .update({
        title: title.trim(),
        status,
        currency: currency.trim() || "INR",
        valid_until: validUntil || null,
        account_id: accountId || null,
        contact_id: contactId || null,
        deal_id: dealId || null,
        discount_type: discountType,
        discount_value: Number(discountValue) || 0,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
      })
      .eq("id", quotation.id);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function remove() {
    setError(null);
    const { error } = await supabase
      .from("quotations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", quotation.id);
    if (error) return setError(error.message);
    router.push("/quotations");
  }

  function emailQuote() {
    const c = contacts.find((x) => x.id === contactId);
    const num = quoteNumber(quotation.quote_number);
    const link = `${window.location.origin}/quotations/${quotation.id}/print`;
    const greeting = c ? contactName(c) : "there";
    const body =
      `Hi ${greeting},\n\nPlease find quotation ${num}. ` +
      `Total: ${money(totals.total, currency)}.\nView it online: ${link}\n\nThank you.`;
    const params = new URLSearchParams({
      compose: "1",
      to: c?.email ?? "",
      name: c ? contactName(c) : "",
      subject: `Quotation ${num}`,
      body,
      rtype: "quotation",
      rid: quotation.id,
    });
    router.push(`/email?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/quotations" className="hover:underline">Quotations</Link>
        <span>/</span>
        <span className="font-mono text-xs">{quoteNumber(quotation.quote_number)}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{title || "Quotation"}</h1>
          <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${QUOTE_STATUS_STYLE[status]}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={emailQuote}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            ✉ Email quote
          </button>
          <Link
            href={`/quotations/${quotation.id}/print`}
            target="_blank"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Download PDF
          </Link>
          {canEdit && (
            <button
              onClick={remove}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {ro && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Read-only — only the owner, Managers and Admins can edit this quotation.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        {/* Left: header + items */}
        <div className="space-y-4">
          {/* Header */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL}>Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={ro} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as QuotationStatus)} disabled={ro} className={`${INPUT} capitalize`}>
                {QUOTATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={ro} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Account</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={ro} className={INPUT}>
                <option value="">— None —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Contact</label>
              <select value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={ro} className={INPUT}>
                <option value="">— None —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{contactName(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Deal</label>
              <select value={dealId} onChange={(e) => setDealId(e.target.value)} disabled={ro} className={INPUT}>
                <option value="">— None —</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={ro} className={INPUT} />
            </div>
          </div>

          {/* Line items */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 w-20">Qty</th>
                  <th className="px-3 py-2 w-28">Unit price</th>
                  <th className="px-3 py-2 w-20">Disc %</th>
                  <th className="px-3 py-2 w-20">Tax %</th>
                  <th className="px-3 py-2 w-28 text-right">Total</th>
                  {!ro && <th className="px-3 py-2 w-8"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={ro ? 6 : 7} className="px-3 py-8 text-center text-slate-400">
                      No line items yet.
                    </td>
                  </tr>
                )}
                {lines.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="px-3 py-2">
                      <input
                        value={l.name}
                        onChange={(e) => patchLine(l.id, { name: e.target.value })}
                        onBlur={() => saveLine(l.id)}
                        disabled={ro}
                        className={`${CELL} font-medium`}
                      />
                      <input
                        value={l.description}
                        onChange={(e) => patchLine(l.id, { description: e.target.value })}
                        onBlur={() => saveLine(l.id)}
                        disabled={ro}
                        placeholder="Description"
                        className={`${CELL} mt-1 text-xs text-slate-500`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} step="0.01" value={l.quantity}
                        onChange={(e) => patchLine(l.id, { quantity: e.target.value })}
                        onBlur={() => saveLine(l.id)} disabled={ro} className={CELL} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} step="0.01" value={l.unit_price}
                        onChange={(e) => patchLine(l.id, { unit_price: e.target.value })}
                        onBlur={() => saveLine(l.id)} disabled={ro} className={CELL} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} max={100} step="0.01" value={l.discount}
                        onChange={(e) => patchLine(l.id, { discount: e.target.value })}
                        onBlur={() => saveLine(l.id)} disabled={ro} className={CELL} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} step="0.01" value={l.tax_rate}
                        onChange={(e) => patchLine(l.id, { tax_rate: e.target.value })}
                        onBlur={() => saveLine(l.id)} disabled={ro} className={CELL} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-700">
                      {money(lineTotal(l), currency)}
                    </td>
                    {!ro && (
                      <td className="px-3 py-2 text-center">
                        <button onClick={() => removeLine(l.id)} className="text-slate-400 hover:text-red-600">×</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {!ro && (
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-3">
                <button onClick={addBlank} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                  + Add line
                </button>
                <select
                  value={picker}
                  onChange={(e) => { if (e.target.value) addProduct(e.target.value); }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">+ Add from product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.sku ? ` (${p.sku})` : ""} — {money(Number(p.unit_price), currency)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Notes & terms */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={ro} rows={3} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Terms &amp; conditions</label>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} disabled={ro} rows={3} className={INPUT} />
            </div>
          </div>
        </div>

        {/* Right: totals + discount */}
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700">Summary</h3>

            <div className="space-y-2">
              <label className={LABEL}>Header discount</label>
              <div className="flex gap-2">
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)} disabled={ro} className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm capitalize outline-none focus:border-brand disabled:bg-slate-50">
                  {DISCOUNT_TYPES.map((d) => (
                    <option key={d} value={d}>{d === "none" ? "No discount" : d === "percent" ? "Percent (%)" : "Amount"}</option>
                  ))}
                </select>
                <input
                  type="number" min={0} step="0.01" value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  disabled={ro || discountType === "none"}
                  className="w-24 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-brand disabled:bg-slate-50"
                />
              </div>
            </div>

            <dl className="space-y-1 border-t border-slate-100 pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-medium">{money(totals.subtotal, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="text-slate-700">− {money(totals.discountAmount, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="text-slate-700">{money(totals.taxAmount, currency)}</dd></div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-800"><dt>Total</dt><dd>{money(totals.total, currency)}</dd></div>
            </dl>
          </div>

          {canEdit && (
            <div className="flex items-center gap-3">
              <button onClick={saveHeader} disabled={busy} className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {busy ? "Saving…" : "Save details"}
              </button>
              {saved && <span className="text-sm text-green-600">Saved ✓</span>}
            </div>
          )}
          <p className="text-xs text-slate-400">
            Line edits save automatically. Use <strong>Save details</strong> for the header, discount, notes and status.
          </p>
        </div>
      </div>
    </div>
  );
}
