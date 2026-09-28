"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import StatTile from "@/components/charts/StatTile";
import { timeAgo, type TenantDetail } from "@/lib/platform";
import { resetTenantPassword, type ResetPasswordResult } from "@/app/(platform)/platform/actions";

export default function TenantDetailClient({ tenant }: { tenant: TenantDetail }) {
  const supabase = createClient();
  const router = useRouter();
  const [status, setStatus] = useState(tenant.status);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<ResetPasswordResult | null>(null);

  const suspended = status === "suspended";

  async function doResetPassword() {
    if (!resetTarget) return;
    setResetBusy(true);
    setResetError(null);
    const res = await resetTenantPassword({ tenantId: tenant.id, email: resetTarget });
    setResetBusy(false);
    if (!res.ok) return setResetError(res.error ?? "Could not reset password.");
    setResetTarget(null);
    setResetResult(res);
  }

  async function toggle() {
    const next = suspended ? "active" : "suspended";
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("admin_set_tenant_status", { p_tenant: tenant.id, p_status: next });
    setBusy(false);
    setConfirm(false);
    if (error) return setError(error.message);
    setStatus(next);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/platform/tenants" className="hover:underline">Tenants</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{tenant.name}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">{tenant.name}</h1>
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${
              suspended ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
            }`}
          >
            {status}
          </span>
        </div>
        <button
          onClick={() => setConfirm(true)}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${
            suspended
              ? "border-green-200 text-green-700 hover:bg-green-50"
              : "border-amber-200 text-amber-700 hover:bg-amber-50"
          }`}
        >
          {suspended ? "Reactivate tenant" : "Suspend tenant"}
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {resetError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{resetError}</div>
      )}
      {resetResult?.ok && (
        <div className="space-y-2 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          <p className="font-semibold text-green-800">Password reset ✓</p>
          <p className="text-green-700">Share these one-time credentials with the admin (shown once):</p>
          <div className="rounded-lg border border-green-200 bg-white p-3 font-mono text-xs">
            <div>email: {resetResult.email}</div>
            <div>password: {resetResult.tempPassword}</div>
          </div>
          <button
            type="button"
            onClick={() => setResetResult(null)}
            className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
          >
            Close
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Users" value={String(tenant.users)} accent />
        <StatTile label="Leads" value={String(tenant.leads)} />
        <StatTile label="Contacts" value={String(tenant.contacts)} />
        <StatTile label="Deals" value={String(tenant.deals)} />
        <StatTile label="Tasks" value={String(tenant.tasks)} />
        <StatTile label="Quotations" value={String(tenant.quotations)} />
        <StatTile label="Last activity" value={timeAgo(tenant.last_activity)} />
        <StatTile label="Plan" value={tenant.plan_tier} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Organization</h2>
          <dl className="space-y-2 text-sm">
            <Row k="Slug" v={tenant.slug} mono />
            <Row k="Currency" v={tenant.currency} />
            <Row k="Timezone" v={tenant.timezone} />
            <Row k="Locale" v={tenant.locale} />
            <Row k="Created" v={new Date(tenant.created_at).toLocaleString()} />
            <div className="flex justify-between gap-3">
              <dt className="pt-0.5 text-slate-400">Admins</dt>
              <dd className="text-right text-slate-700">
                {tenant.admins.length === 0 ? (
                  "—"
                ) : (
                  <ul className="space-y-1">
                    {tenant.admins.map((email) => (
                      <li key={email} className="flex items-center justify-end gap-2">
                        <span>{email}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(email);
                            setResetError(null);
                          }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Reset password
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Integrations</h2>
          {tenant.integrations.length === 0 ? (
            <p className="text-sm text-slate-400">None configured.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {tenant.integrations.map((i) => (
                <li key={i.channel} className="flex items-center justify-between">
                  <span className="capitalize text-slate-600">{i.channel}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      i.enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {i.enabled ? "enabled" : "off"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Platform admins see configuration status only — never message contents or CRM data.
          </p>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title={suspended ? "Reactivate this tenant?" : "Suspend this tenant?"}
          message={
            suspended
              ? `"${tenant.name}" will regain access to the application.`
              : `"${tenant.name}" members will be blocked from the app until reactivated.`
          }
          confirmLabel={suspended ? "Reactivate" : "Suspend"}
          danger={!suspended}
          busy={busy}
          onConfirm={toggle}
          onCancel={() => setConfirm(false)}
        />
      )}

      {resetTarget && (
        <ConfirmDialog
          title="Reset this admin's password?"
          message={`A new one-time password will be generated for ${resetTarget}. Their current password stops working immediately.`}
          confirmLabel="Reset password"
          danger={false}
          busy={resetBusy}
          onConfirm={doResetPassword}
          onCancel={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-400">{k}</dt>
      <dd className={`text-right text-slate-700 ${mono ? "font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
