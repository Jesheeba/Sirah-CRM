"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COMM_STATUS_STYLE } from "@/lib/email";
import type { Communication, EmailTemplate } from "@/lib/types";
import EmailComposer, { type ComposerPrefill } from "./EmailComposer";

type Tab = "all" | "outbound" | "inbound";

export default function EmailClient({
  initial,
  templates,
  providerEnabled,
  initialCompose,
}: {
  initial: Communication[];
  templates: EmailTemplate[];
  providerEnabled: boolean;
  initialCompose?: ComposerPrefill | null;
}) {
  const router = useRouter();
  const [rows] = useState<Communication[]>(initial);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [composing, setComposing] = useState<ComposerPrefill | null>(initialCompose ?? null);

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (tab !== "all" && r.direction !== tab) return false;
    if (q) {
      const hay = `${r.to_email ?? ""} ${r.from_email ?? ""} ${r.subject ?? ""} ${r.to_name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const TABS: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "outbound", label: "Sent" },
    { key: "inbound", label: "Received" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Email</h1>
        <div className="flex gap-2">
          <Link href="/email/templates" className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            Templates
          </Link>
          <button onClick={() => setComposing({})} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            + Compose
          </button>
        </div>
      </div>

      {!providerEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          No email provider configured — sending opens your mail client and logs the message here.
          Set <code className="rounded bg-amber-100 px-1">RESEND_API_KEY</code> and{" "}
          <code className="rounded bg-amber-100 px-1">EMAIL_FROM</code> to enable direct send + open tracking.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key ? "bg-brand-50 text-brand" : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          placeholder="Search recipient or subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand sm:max-w-xs"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3"></th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  {rows.length === 0 ? "No emails yet — compose one to get started." : "No emails match."}
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-400">{r.direction === "inbound" ? "↓" : "↑"}</td>
                <td className="px-4 py-3 text-slate-700">
                  {r.direction === "inbound" ? r.from_email : r.to_name || r.to_email || "—"}
                </td>
                <td className="px-4 py-3 font-medium text-slate-700">{r.subject || <span className="text-slate-300">(no subject)</span>}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${COMM_STATUS_STYLE[r.status]}`}>
                    {r.status}
                  </span>
                  {r.opened_at && r.status !== "opened" && <span className="ml-1 text-xs text-green-600">· opened</span>}
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.sent_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {composing && (
        <EmailComposer
          templates={templates}
          providerEnabled={providerEnabled}
          prefill={composing}
          onClose={() => setComposing(null)}
          onSent={() => router.refresh()}
        />
      )}
    </div>
  );
}
