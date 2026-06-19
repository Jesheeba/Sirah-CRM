"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { timeAgo, type AdminTenantRow } from "@/lib/platform";
import { provisionTenant, type ProvisionResult } from "@/app/(platform)/platform/actions";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-amber-100 text-amber-700",
};

const LABEL = "text-xs uppercase tracking-wide text-slate-400";
const INPUT = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand";

export default function TenantsClient({ initial }: { initial: AdminTenantRow[] }) {
  const router = useRouter();
  const [rows] = useState<AdminTenantRow[]>(initial);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((t) => {
    if (status && t.status !== status) return false;
    if (q && !`${t.name} ${t.slug}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Tenants</h1>
          <p className="text-sm text-slate-500">{rows.length} organizations · counts only, no CRM data.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          + Provision tenant
        </button>
      </div>

      {showForm && <ProvisionForm onClose={() => setShowForm(false)} onDone={() => router.refresh()} />}

      <div className="flex flex-wrap gap-2">
        <input
          placeholder="Search name or slug…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-xs"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3 text-right">Users</th>
              <th className="px-4 py-3 text-right">Leads</th>
              <th className="px-4 py-3 text-right">Contacts</th>
              <th className="px-4 py-3 text-right">Deals</th>
              <th className="px-4 py-3">Last activity</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">No tenants match.</td>
              </tr>
            )}
            {visible.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/platform/tenants/${t.id}`} className="font-medium text-brand hover:underline">
                    {t.name}
                  </Link>
                  <div className="font-mono text-xs text-slate-400">{t.slug}</div>
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{t.users}</td>
                <td className="px-4 py-3 text-right text-slate-600">{t.leads}</td>
                <td className="px-4 py-3 text-right text-slate-600">{t.contacts}</td>
                <td className="px-4 py-3 text-right text-slate-600">{t.deals}</td>
                <td className="px-4 py-3 text-slate-500">{timeAgo(t.last_activity)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[t.status] ?? ""}`}>
                    {t.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProvisionForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [orgName, setOrgName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ProvisionResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await provisionTenant({ orgName, ownerEmail, currency });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Provisioning failed.");
    setDone(res);
    onDone();
  }

  if (done?.ok) {
    return (
      <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
        <p className="font-semibold text-green-800">Tenant provisioned ✓</p>
        <p className="text-green-700">
          Share these one-time credentials with the owner (shown once):
        </p>
        <div className="rounded-lg border border-green-200 bg-white p-3 font-mono text-xs">
          <div>email: {done.ownerEmail}</div>
          <div>password: {done.tempPassword}</div>
        </div>
        <div className="flex gap-2 pt-1">
          <Link href={`/platform/tenants/${done.tenantId}`} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            Open tenant
          </Link>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-white">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Provision a new tenant</h2>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Organization name</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Owner email</label>
          <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Currency</label>
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={INPUT} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Provisioning…" : "Create tenant"}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
      </div>
      <p className="text-xs text-slate-400">Creates the org + a first Admin user. The owner gets a one-time password to sign in and change.</p>
    </form>
  );
}
