"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { manageLeadFeed } from "@/app/(platform)/platform/actions";

export default function LeadFeedCard({
  tenantId,
  initialToken,
  appBase,
}: {
  tenantId: string;
  initialToken: string | null;
  appBase: string;
}) {
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"rotate" | "disable" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const base = appBase || (typeof window !== "undefined" ? window.location.origin : "");
  const url = (format: "json" | "csv") =>
    `${base}/api/export/facebook-leads?token=${token}&format=${format}`;

  async function run(action: "generate" | "disable") {
    setBusy(true);
    setError(null);
    const res = await manageLeadFeed({ tenantId, action });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    setToken(res.token ?? null);
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Lead feed (pull)</h2>
          <p className="text-xs text-slate-400">
            Private link an external CRM, Excel or Google Sheets can pull this client&apos;s Facebook &amp;
            Instagram lead-ad leads from.
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${
            token ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {token ? "Active" : "Off"}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {token ? (
        <div className="space-y-3">
          {(["json", "csv"] as const).map((f) => (
            <div key={f}>
              <p className="mb-1 text-xs font-medium uppercase text-slate-500">
                {f === "json" ? "JSON (other CRMs / APIs)" : "CSV (Excel / Google Sheets)"}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={url(f)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-600"
                />
                <button
                  type="button"
                  onClick={() => copy(f, url(f))}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  {copied === f ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
          ))}

          <p className="text-xs text-slate-400">
            Add <span className="font-mono">&amp;since=&lt;next_since&gt;</span> to fetch only newer leads (JSON
            returns <span className="font-mono">next_since</span>), and{" "}
            <span className="font-mono">&amp;limit=</span> (max 1000). Excel: Data → From Web. Google Sheets:{" "}
            <span className="font-mono">=IMPORTDATA(&quot;…csv link…&quot;)</span>.
          </p>
          <p className="text-xs text-amber-700">
            Anyone with this link can read this client&apos;s lead data. Share it only with the client&apos;s
            own systems.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirm("rotate")}
              disabled={busy}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Regenerate link
            </button>
            <button
              type="button"
              onClick={() => setConfirm("disable")}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Disable feed
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => run("generate")}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Generating…" : "Generate feed link"}
        </button>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === "rotate" ? "Regenerate this link?" : "Disable this feed?"}
          message={
            confirm === "rotate"
              ? "The current link stops working immediately. Anything still using it must be updated with the new link."
              : "The link stops working immediately. You can generate a new one later."
          }
          confirmLabel={confirm === "rotate" ? "Regenerate" : "Disable"}
          danger={confirm === "disable"}
          busy={busy}
          onConfirm={() => run(confirm === "rotate" ? "generate" : "disable")}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
