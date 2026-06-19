"use client";

import { useState } from "react";
import Link from "next/link";
import { money } from "@/lib/reports";
import { quoteNumber, QUOTE_STATUS_STYLE } from "@/lib/quotations";
import { QUOTATION_STATUSES, type Quotation } from "@/lib/types";
import NewQuotationButton from "./NewQuotationButton";

export default function QuotationsClient({ initial }: { initial: Quotation[] }) {
  const [rows] = useState<Quotation[]>(initial);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (q) {
      const hay = `${quoteNumber(r.quote_number)} ${r.title} ${r.accounts?.name ?? ""} ${
        r.deals?.name ?? ""
      }`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Quotations</h1>
        <NewQuotationButton />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search number, title, account or deal…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
        >
          <option value="">All statuses</option>
          {QUOTATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Account / Deal</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Valid until</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  {rows.length === 0 ? "No quotations yet." : "No quotations match your filters."}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  <Link href={`/quotations/${r.id}`} className="text-brand hover:underline">
                    {quoteNumber(r.quote_number)}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium text-slate-700">
                  <Link href={`/quotations/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {r.accounts?.name ?? r.deals?.name ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${
                      QUOTE_STATUS_STYLE[r.status]
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {r.valid_until ? new Date(r.valid_until).toLocaleDateString() : "—"}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">
                  {money(Number(r.total), r.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
