"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  createLeadFeedKey,
  revokeLeadFeedKey,
  type LeadFeedKeyInfo,
} from "@/app/(platform)/platform/actions";

function fmt(at: string | null): string {
  if (!at) return "never";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
}

export default function LeadFeedCard({
  tenantId,
  initialKeys,
  appBase,
}: {
  tenantId: string;
  initialKeys: LeadFeedKeyInfo[];
  appBase: string;
}) {
  const [keys, setKeys] = useState(initialKeys);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoke, setRevoke] = useState<LeadFeedKeyInfo | null>(null);
  // The full key exists only here, once, right after creation. It is never stored or re-fetchable.
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const base = appBase || (typeof window !== "undefined" ? window.location.origin : "");
  const endpoint = `${base}/api/export/facebook-leads`;
  const active = keys.filter((k) => !k.revoked_at);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createLeadFeedKey({ tenantId, name });
    setBusy(false);
    if (!res.ok || !res.key || !res.info) return setError(res.error ?? "Could not create the key.");
    setKeys((prev) => [res.info!, ...prev]);
    setFresh({ name: res.info.name, key: res.key });
    setName("");
  }

  async function doRevoke() {
    if (!revoke) return;
    setBusy(true);
    setError(null);
    const res = await revokeLeadFeedKey({ tenantId, keyId: revoke.id });
    setBusy(false);
    if (!res.ok) {
      setRevoke(null);
      return setError(res.error ?? "Could not revoke the key.");
    }
    setKeys((prev) => prev.map((k) => (k.id === revoke.id ? { ...k, revoked_at: new Date().toISOString() } : k)));
    setRevoke(null);
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy — select the text and copy it manually.");
    }
  }

  const curl = fresh ? `curl -H "Authorization: Bearer ${fresh.key}" "${endpoint}?format=json"` : "";
  const sheetsUrl = fresh ? `${endpoint}?format=csv&token=${fresh.key}` : "";

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Lead feed API (pull)</h2>
          <p className="text-xs text-slate-400">
            External CRMs, Excel and Google Sheets pull this client&apos;s Facebook &amp; Instagram lead-ad leads
            with an API key. Keys are stored hashed, limited to 60 requests/minute each, and can be revoked
            individually.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            active.length ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {active.length ? `${active.length} active key${active.length > 1 ? "s" : ""}` : "Off"}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {fresh && (
        <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-semibold text-green-800">Key “{fresh.name}” created ✓</p>
          <p className="text-xs text-green-700">
            Copy it now. It&apos;s stored only as a hash and <strong>can&apos;t be shown again</strong>. If it&apos;s lost,
            create a new key and revoke this one.
          </p>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-slate-500">API key</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={fresh.key}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={() => copy("key", fresh.key)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {copied === "key" ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-slate-500">
              Recommended — key sent in a header (other CRMs, scripts, APIs)
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={curl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={() => copy("curl", curl)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {copied === "curl" ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium uppercase text-amber-700">
              Excel / Google Sheets only — key is in the URL (less secure)
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={sheetsUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-2 py-1.5 font-mono text-xs text-slate-600"
              />
              <button
                type="button"
                onClick={() => copy("sheets", sheetsUrl)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                {copied === "sheets" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Those tools can&apos;t send headers. Make a separate key just for them, so it can be revoked on its own.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setFresh(null)}
            className="rounded-lg border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
          >
            I&apos;ve saved it — close
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-slate-500">
          New key name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Zoho CRM, Finance sheet"
            maxLength={60}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Create key"}
        </button>
      </div>

      {keys.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${k.revoked_at ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    {k.name}
                  </span>
                  <span className="font-mono text-xs text-slate-400">{k.key_prefix}…</span>
                  {k.revoked_at && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      revoked
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Created {fmt(k.created_at)} · Last used {fmt(k.last_used_at)}
                  {k.last_used_via === "url" && !k.revoked_at && (
                    <span className="text-amber-600"> · used with key in URL</span>
                  )}
                </p>
              </div>
              {!k.revoked_at && (
                <button
                  type="button"
                  onClick={() => setRevoke(k)}
                  disabled={busy}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Add <span className="font-mono">&amp;since=&lt;next_since&gt;</span> to fetch only newer leads and{" "}
        <span className="font-mono">&amp;limit=</span> (max 1000). Excel: Data → From Web. Google Sheets:{" "}
        <span className="font-mono">=IMPORTDATA(&quot;…&quot;)</span>. Anyone with a key can read this client&apos;s lead
        data — share it only with the client&apos;s own systems.
      </p>

      {revoke && (
        <ConfirmDialog
          title="Revoke this key?"
          message={`“${revoke.name}” stops working immediately. Anything still using it will get 401 errors. Other keys are not affected.`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={doRevoke}
          onCancel={() => setRevoke(null)}
        />
      )}
    </div>
  );
}
