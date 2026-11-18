"use client";

import { useState } from "react";
import { setupSocialDesk } from "@/app/(platform)/platform/actions";
import type { DeskStatus } from "@/lib/social-desk-setup";

/** Super Admin: set a tenant up as an Instagram social desk (e.g. an MLA's office). */
export default function SocialDeskCard({ tenantId, initial }: { tenantId: string; initial: DeskStatus }) {
  const [status, setStatus] = useState(initial);
  const [renameLeads, setRenameLeads] = useState(initial.leadsLabel === "Issues" || !initial.socialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(false);
    const r = await setupSocialDesk({ tenantId, renameLeads });
    setBusy(false);
    if (!r.ok || !r.status) return setError(r.error ?? "Setup failed.");
    setStatus(r.status);
    setDone(true);
  }

  const row = (ok: boolean, text: string) => (
    <li className="flex items-center gap-2">
      <span aria-hidden className={ok ? "text-green-600" : "text-slate-300"}>{ok ? "✓" : "○"}</span>
      <span className={ok ? "text-slate-700" : "text-slate-500"}>{text}</span>
    </li>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="desk-title">
      <h2 id="desk-title" className="text-base font-semibold text-slate-800">Instagram social desk</h2>
      <p className="text-sm text-slate-500">
        For accounts that handle Instagram comments, @mentions and messages (e.g. an MLA&apos;s office). Admins see everything,
        Managers approve replies, Sales Reps draft them.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {row(status.socialEnabled, "Social module switched on")}
        {row(status.hasSettings, status.hasSettings ? `Replies: ${status.replyMode === "direct" ? "posted directly by admins/managers" : "need approval"}` : "Reply settings created (approval required)")}
        {row(status.leadsLabel === "Issues", 'Leads shown as "Issues"')}
        {row(status.instagramAccounts > 0, status.instagramAccounts ? `${status.instagramAccounts} Instagram account(s) connected` : "Instagram account connected — done by the tenant admin in Settings → Integrations")}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={renameLeads} onChange={(e) => setRenameLeads(e.target.checked)} />
        Rename “Leads” to “Issues” for this tenant
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={run} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? "Setting up…" : status.socialEnabled ? "Run setup again" : "Set up social desk"}
        </button>
        {done && <span role="status" className="text-sm text-green-700">Done. Safe to run again — it never removes the tenant&apos;s own settings.</span>}
        {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      </div>
    </section>
  );
}
