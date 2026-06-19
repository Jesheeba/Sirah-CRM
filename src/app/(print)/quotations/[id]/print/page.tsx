import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { money } from "@/lib/reports";
import { quoteNumber } from "@/lib/quotations";
import PrintActions from "@/components/quotations/PrintActions";
import type { Quotation, QuotationItem } from "@/lib/types";

export default async function QuotationPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: q }, itemsRes] = await Promise.all([
    supabase
      .from("quotations")
      .select("*, accounts(name, website, phone), contacts(first_name, last_name, email, phone)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("quotation_items").select("*").eq("quotation_id", id).order("position"),
  ]);

  if (!q) notFound();
  const quote = q as Quotation & {
    accounts?: { name: string; website: string | null; phone: string | null } | null;
    contacts?: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null;
  };
  const items = (itemsRes.data ?? []) as QuotationItem[];
  const cur = quote.currency;

  const contactName = quote.contacts
    ? `${quote.contacts.first_name ?? ""} ${quote.contacts.last_name ?? ""}`.trim()
    : "";

  return (
    <>
      <PrintActions backHref={`/quotations/${quote.id}`} />

      <div className="mx-auto max-w-3xl bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-bold text-brand">{ctx.tenantName}</h1>
            <p className="mt-1 text-sm text-slate-500">Quotation</p>
          </div>
          <div className="text-right text-sm">
            <div className="font-mono text-base font-semibold text-slate-800">
              {quoteNumber(quote.quote_number)}
            </div>
            <div className="mt-1 capitalize text-slate-500">Status: {quote.status}</div>
            {quote.valid_until && (
              <div className="text-slate-500">
                Valid until {new Date(quote.valid_until).toLocaleDateString()}
              </div>
            )}
            <div className="text-slate-400">
              {new Date(quote.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Bill to */}
        <div className="grid grid-cols-2 gap-6 py-6 text-sm">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Prepared for</div>
            {quote.accounts?.name && <div className="font-semibold text-slate-800">{quote.accounts.name}</div>}
            {contactName && <div className="text-slate-600">{contactName}</div>}
            {quote.contacts?.email && <div className="text-slate-500">{quote.contacts.email}</div>}
            {quote.contacts?.phone && <div className="text-slate-500">{quote.contacts.phone}</div>}
            {!quote.accounts?.name && !contactName && <div className="text-slate-400">—</div>}
          </div>
          <div className="text-right">
            <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Title</div>
            <div className="font-semibold text-slate-800">{quote.title}</div>
          </div>
        </div>

        {/* Items */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 px-2 text-right">Qty</th>
              <th className="py-2 px-2 text-right">Unit price</th>
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
                  {it.description && <div className="text-xs text-slate-500">{it.description}</div>}
                </td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.quantity)}</td>
                <td className="py-2 px-2 text-right text-slate-600">{money(Number(it.unit_price), cur)}</td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.discount)}</td>
                <td className="py-2 px-2 text-right text-slate-600">{Number(it.tax_rate)}</td>
                <td className="py-2 pl-2 text-right font-medium text-slate-800">{money(Number(it.line_total), cur)}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-slate-400">No line items.</td></tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-6 flex justify-end">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="text-slate-700">{money(Number(quote.subtotal), cur)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="text-slate-700">− {money(Number(quote.discount_amount), cur)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tax</dt><dd className="text-slate-700">{money(Number(quote.tax_amount), cur)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900"><dt>Total</dt><dd>{money(Number(quote.total), cur)}</dd></div>
          </dl>
        </div>

        {/* Notes & terms */}
        {(quote.notes || quote.terms) && (
          <div className="mt-8 space-y-4 border-t border-slate-200 pt-6 text-sm">
            {quote.notes && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Notes</div>
                <p className="whitespace-pre-wrap text-slate-600">{quote.notes}</p>
              </div>
            )}
            {quote.terms && (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Terms &amp; conditions</div>
                <p className="whitespace-pre-wrap text-slate-600">{quote.terms}</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          Generated by {ctx.tenantName} · {quoteNumber(quote.quote_number)}
        </div>
      </div>
    </>
  );
}
