"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Invoice, PaymentStatus, InvoiceStatus } from "@/lib/types";
import { createInvoice } from "@/app/(app)/invoices/actions";

function money(n: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

function invoiceNumber(n: number | null) {
  return n != null ? `INV-${String(n).padStart(5, "0")}` : "—";
}

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  sent:      "bg-blue-100 text-blue-700",
  overdue:   "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const PAY_STYLE: Record<PaymentStatus, string> = {
  unpaid:  "bg-amber-100 text-amber-700",
  partial: "bg-purple-100 text-purple-700",
  paid:    "bg-green-100 text-green-700",
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export default function InvoicesClient({
  invoices,
  canCreate,
}: {
  invoices: Invoice[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [payFilter, setPayFilter] = useState<PaymentStatus | "all">("all");
  const [isPending, startTransition] = useTransition();

  const filtered = invoices.filter((inv) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      inv.title.toLowerCase().includes(q) ||
      (inv.accounts as { name: string } | null)?.name.toLowerCase().includes(q) ||
      String(inv.invoice_number).includes(q);
    const matchPay = payFilter === "all" || inv.payment_status === payFilter;
    return matchSearch && matchPay;
  });

  function handleCreate() {
    startTransition(async () => {
      const res = await createInvoice();
      if (res.ok && res.id) router.push(`/invoices/${res.id}`);
    });
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoices…"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <select
          value={payFilter}
          onChange={(e) => setPayFilter(e.target.value as PaymentStatus | "all")}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="all">All payments</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        {canCreate && (
          <button
            onClick={handleCreate}
            disabled={isPending}
            className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "+ New invoice"}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 text-left">Invoice #</th>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Account</th>
              <th className="px-4 py-3 text-left">Invoice Date</th>
              <th className="px-4 py-3 text-left">Due Date</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Payment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-sm text-slate-400">
                  {search || payFilter !== "all" ? "No invoices match your filters." : "No invoices yet. Create your first one."}
                </td>
              </tr>
            )}
            {filtered.map((inv) => (
              <tr
                key={inv.id}
                onClick={() => router.push(`/invoices/${inv.id}`)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-mono text-xs text-slate-500">
                  {invoiceNumber(inv.invoice_number)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-800">{inv.title}</td>
                <td className="px-4 py-3 text-slate-600">
                  {(inv.accounts as { name: string } | null)?.name ?? <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {inv.due_date ? new Date(inv.due_date).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {money(inv.total, inv.currency)}
                </td>
                <td className="px-4 py-3">
                  <Badge label={inv.status} cls={STATUS_STYLE[inv.status]} />
                </td>
                <td className="px-4 py-3">
                  <Badge label={inv.payment_status} cls={PAY_STYLE[inv.payment_status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-slate-400">
          Showing {filtered.length} of {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
