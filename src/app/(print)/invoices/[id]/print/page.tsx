import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { money } from "@/lib/reports";
import PrintActions from "@/components/invoices/InvoicePrintActions";
import type { Invoice, InvoiceItem } from "@/lib/types";

function invoiceNumber(n: number | null) {
  return n != null ? `INV-${String(n).padStart(5, "0")}` : "Invoice";
}

export default async function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: inv }, itemsRes, brandingRes] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, accounts(name, website, phone), contacts(first_name, last_name, email, phone)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", id)
      .order("position"),
    supabase
      .from("organization_branding")
      .select("seller_gstin, seller_state_code")
      .maybeSingle(),
  ]);

  if (!inv) notFound();

  const invoice = inv as Invoice & {
    accounts?: { name: string; website: string | null; phone: string | null } | null;
    contacts?: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  };
  const items = (itemsRes.data ?? []) as InvoiceItem[];
  const cur = invoice.currency;

  const contactName = invoice.contacts
    ? `${invoice.contacts.first_name ?? ""} ${invoice.contacts.last_name ?? ""}`.trim()
    : "";

  const balance = Number(invoice.total) - Number(invoice.paid_amount);
  const branding = brandingRes.data as { seller_gstin: string | null; seller_state_code: string | null } | null;
  const isIntraState = invoice.place_of_supply && branding?.seller_state_code
    && invoice.place_of_supply === branding.seller_state_code;

  return (
    <>
      <PrintActions backHref={`/invoices/${invoice.id}`} invoiceNumber={invoiceNumber(invoice.invoice_number)} />

      <div className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-bold text-brand">{ctx.tenantName}</h1>
            <p className="mt-1 text-sm text-slate-500">Tax Invoice</p>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono text-base font-semibold text-slate-800">
              {invoiceNumber(invoice.invoice_number)}
            </div>
            <div className="mt-1 capitalize text-slate-500">Status: {invoice.status}</div>
            <div className="capitalize text-slate-500">Payment: {invoice.payment_status}</div>
            <div className="text-slate-400">
              Date: {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString("en-IN") : "—"}
            </div>
            {invoice.due_date && (
              <div className="text-slate-400">
                Due: {new Date(invoice.due_date).toLocaleDateString("en-IN")}
              </div>
            )}
          </div>
        </div>

        {/* Seller + Buyer */}
        <div className="grid grid-cols-2 gap-6 py-6 text-sm">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Bill To</div>
            {invoice.accounts?.name && (
              <div className="font-semibold text-slate-800">{invoice.accounts.name}</div>
            )}
            {contactName && <div className="text-slate-600">{contactName}</div>}
            {invoice.contacts?.email && (
              <div className="text-slate-500">{invoice.contacts.email}</div>
            )}
            {invoice.contacts?.phone && (
              <div className="text-slate-500">{invoice.contacts.phone}</div>
            )}
            {invoice.customer_gstin && (
              <div className="mt-1 font-mono text-xs text-slate-500">GSTIN: {invoice.customer_gstin}</div>
            )}
            {invoice.place_of_supply && (
              <div className="text-xs text-slate-400">Place of Supply: {invoice.place_of_supply}</div>
            )}
            {!invoice.accounts?.name && !contactName && (
              <div className="text-slate-400">—</div>
            )}
          </div>
          <div className="text-right">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Invoice Title</div>
            <div className="font-semibold text-slate-800">{invoice.title}</div>
            <div className="mt-2 text-xs uppercase tracking-wide text-slate-400">Currency</div>
            <div className="text-slate-600">{cur}</div>
            {branding?.seller_gstin && (
              <>
                <div className="mt-2 text-xs uppercase tracking-wide text-slate-400">Our GSTIN</div>
                <div className="font-mono text-xs text-slate-600">{branding.seller_gstin}</div>
              </>
            )}
          </div>
        </div>

        {/* Line items */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 px-2">HSN/SAC</th>
              <th className="py-2 px-2 text-right">Qty</th>
              <th className="py-2 px-2 text-right">Unit Price</th>
              <th className="py-2 px-2 text-right">Disc %</th>
              <th className="py-2 px-2 text-right">Tax %</th>
              <th className="py-2 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-2">
                  <div className="font-medium text-slate-800">{it.name}</div>
                  {it.description && (
                    <div className="text-xs text-slate-500">{it.description}</div>
                  )}
                </td>
                <td className="py-2 px-2 font-mono text-xs text-slate-500">
                  {(it as InvoiceItem & { hsn_sac: string | null }).hsn_sac ?? "—"}
                </td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.quantity)}</td>
                <td className="py-2 px-2 text-right text-slate-600">{money(Number(it.unit_price), cur)}</td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.discount)}%</td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.tax_rate)}%</td>
                <td className="py-2 pl-2 text-right font-medium text-slate-800">
                  {money(Number(it.line_total), cur)}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-400">
                  No line items.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <dl className="w-72 space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="text-slate-700">{money(Number(invoice.subtotal), cur)}</dd>
            </div>
            {Number(invoice.discount_amount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd className="text-red-600">− {money(Number(invoice.discount_amount), cur)}</dd>
              </div>
            )}
            {isIntraState ? (
              <>
                <div className="flex justify-between">
                  <dt className="text-slate-500">CGST</dt>
                  <dd className="text-slate-700">{money(Number(invoice.cgst), cur)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">SGST</dt>
                  <dd className="text-slate-700">{money(Number(invoice.sgst), cur)}</dd>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <dt className="text-slate-500">{invoice.place_of_supply ? "IGST" : "Tax"}</dt>
                <dd className="text-slate-700">{money(Number(invoice.tax_amount), cur)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <dt>Total</dt>
              <dd>{money(Number(invoice.total), cur)}</dd>
            </div>
            {Number(invoice.paid_amount) > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-700">
                  <dt>Amount Paid</dt>
                  <dd>{money(Number(invoice.paid_amount), cur)}</dd>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold text-slate-800">
                  <dt>Balance Due</dt>
                  <dd className={balance > 0 ? "text-amber-600" : "text-green-700"}>
                    {money(balance, cur)}
                  </dd>
                </div>
              </>
            )}
          </dl>
        </div>

        {/* Notes & Terms */}
        {(invoice.notes || invoice.terms) && (
          <div className="mt-8 space-y-4 border-t border-slate-200 pt-6 text-sm">
            {invoice.notes && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Notes</div>
                <p className="whitespace-pre-wrap text-slate-600">{invoice.notes}</p>
              </div>
            )}
            {invoice.terms && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">
                  Terms &amp; Conditions
                </div>
                <p className="whitespace-pre-wrap text-slate-600">{invoice.terms}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          Generated by {ctx.tenantName} · {invoiceNumber(invoice.invoice_number)}
        </div>
      </div>
    </>
  );
}
