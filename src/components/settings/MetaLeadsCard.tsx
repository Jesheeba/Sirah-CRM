"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  disconnectMetaPage,
  setMetaPageEnabled,
  setMetaPageOwner,
  importHistoricalLeads,
  type ImportResult,
} from "@/app/(app)/settings/integrations/meta-actions";
import type { MetaLeadPage } from "@/lib/types";

export interface MetaMember {
  id: string;
  name: string;
}

const REASONS: Record<string, string> = {
  unconfigured: "Meta app not configured yet — set META_APP_ID / META_APP_SECRET in the server env.",
  denied: "You cancelled or denied the Facebook permission.",
  state: "Security check failed. Please try connecting again.",
  nopages: "No Facebook Pages were found on that account.",
  save: "Couldn't save the connected page(s). Please try again.",
  oauth: "Facebook sign-in failed. Please try again.",
};

export default function MetaLeadsCard({
  pages,
  members,
  configured,
  notice,
  reason,
  connectedCount,
}: {
  pages: MetaLeadPage[];
  members: MetaMember[];
  configured: boolean;
  notice: string | null;
  reason: string | null;
  connectedCount: string | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPage, setConfirmPage] = useState<MetaLeadPage | null>(null);
  const [importResults, setImportResults] = useState<Record<string, ImportResult>>({});

  async function toggle(page: MetaLeadPage, enabled: boolean) {
    setError(null);
    setBusyId(page.page_id);
    const res = await setMetaPageEnabled(page.page_id, enabled);
    setBusyId(null);
    if (!res.ok) setError(res.error ?? "Could not update.");
    else router.refresh();
  }

  async function changeOwner(page: MetaLeadPage, ownerId: string) {
    setError(null);
    setBusyId(page.page_id);
    const res = await setMetaPageOwner(page.page_id, ownerId || null);
    setBusyId(null);
    if (!res.ok) setError(res.error ?? "Could not update.");
    else router.refresh();
  }

  async function startImport(page: MetaLeadPage) {
    setError(null);
    setBusyId(page.page_id);
    const res = await importHistoricalLeads(page.page_id);
    setBusyId(null);
    setImportResults((prev) => ({ ...prev, [page.page_id]: res }));
    if (!res.ok) setError(res.error ?? "Import failed.");
  }

  async function confirmDisconnect() {
    if (!confirmPage) return;
    setError(null);
    setBusyId(confirmPage.page_id);
    const res = await disconnectMetaPage(confirmPage.page_id);
    setBusyId(null);
    setConfirmPage(null);
    if (!res.ok) setError(res.error ?? "Could not disconnect.");
    else router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Meta Lead Ads</h2>
          <p className="text-xs text-slate-400">Facebook &amp; Instagram · auto-import leads from your ads</p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            pages.length ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {pages.length ? `${pages.length} page${pages.length > 1 ? "s" : ""} connected` : "Not connected"}
        </span>
      </div>

      {notice === "connected" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          Connected {connectedCount ?? ""} page{connectedCount === "1" ? "" : "s"}. Leads will now arrive
          automatically.
        </div>
      )}
      {notice === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(reason && REASONS[reason]) ?? "Something went wrong connecting Facebook."}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Connected pages */}
      {pages.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {pages.map((page) => (
            <div key={page.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-700">
                    {page.page_name || "Facebook Page"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      page.subscribed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {page.subscribed ? "Subscribed" : "Not subscribed"}
                  </span>
                </div>
                <p className="font-mono text-xs text-slate-400">ID {page.page_id}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-slate-500">
                  Assign to
                  <select
                    value={page.default_owner_id ?? ""}
                    onChange={(e) => changeOwner(page, e.target.value)}
                    disabled={busyId === page.page_id}
                    className="ml-2 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand disabled:opacity-50"
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={page.is_enabled}
                    onChange={(e) => toggle(page, e.target.checked)}
                    disabled={busyId === page.page_id}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Enabled
                </label>

                <button
                  type="button"
                  onClick={() => startImport(page)}
                  disabled={busyId === page.page_id}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  {busyId === page.page_id ? "Importing…" : "Import past leads"}
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmPage(page)}
                  disabled={busyId === page.page_id}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                >
                  Disconnect
                </button>

                {importResults[page.page_id] && (
                  <span className={`text-xs font-medium ${importResults[page.page_id].ok ? "text-green-600" : "text-red-600"}`}>
                    {importResults[page.page_id].ok
                      ? `✓ ${importResults[page.page_id].imported} imported, ${importResults[page.page_id].skipped} skipped`
                      : importResults[page.page_id].error}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Connect button */}
      {configured ? (
        <a
          href="/api/meta/oauth/start"
          className="inline-flex items-center gap-2 rounded-lg bg-[#1877F2] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {pages.length ? "Connect another page" : "Connect Facebook"}
        </a>
      ) : (
        <p className="text-xs text-slate-400">
          Set <span className="font-mono">META_APP_ID</span> and{" "}
          <span className="font-mono">META_APP_SECRET</span> in the server environment to enable the
          Connect Facebook button.
        </p>
      )}

      <p className="text-xs text-slate-400">
        Leads from connected pages appear in <span className="font-medium">Leads</span> with source
        “Facebook Lead Ads”. Set an owner per page to route them to a rep (otherwise they stay
        unassigned and are visible to Admins/Managers).
      </p>

      <ConfirmDialog
        open={Boolean(confirmPage)}
        title="Disconnect this page?"
        message={`New leads from “${confirmPage?.page_name || confirmPage?.page_id}” will stop arriving. Existing leads are kept.`}
        confirmLabel="Disconnect"
        busy={busyId !== null && busyId === confirmPage?.page_id}
        onConfirm={confirmDisconnect}
        onCancel={() => setConfirmPage(null)}
      />
    </div>
  );
}
