"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import {
  createWebhookChannel,
  deleteWebhookChannel,
  rotateWebhookSecret,
  setWebhookChannelEnabled,
  type WebhookChannelInfo,
  type WebhookDeliveryInfo,
} from "@/app/(platform)/platform/actions";

function fmt(at: string | null): string {
  if (!at) return "never";
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
}

type Pending = { kind: "rotate" | "delete"; channel: WebhookChannelInfo } | null;

export default function WebhookChannelsCard({
  tenantId,
  initialChannels,
  deliveries,
  appBase,
}: {
  tenantId: string;
  initialChannels: WebhookChannelInfo[];
  deliveries: WebhookDeliveryInfo[];
  appBase: string;
}) {
  const [channels, setChannels] = useState(initialChannels);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  // The secret exists on screen only once, right after create/rotate — it is never re-fetchable.
  const [fresh, setFresh] = useState<{ channel: string; secret: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const base = appBase || (typeof window !== "undefined" ? window.location.origin : "");
  const url = (c: string) => `${base}/api/v1/leads/webhook/${c}`;
  const byId = new Map(channels.map((c) => [c.id, c.channel]));

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Couldn't copy — select the text and copy it manually.");
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createWebhookChannel({ tenantId, channel: slug, name });
    setBusy(false);
    if (!res.ok || !res.info || !res.secret) return setError(res.error ?? "Could not create the channel.");
    setChannels((prev) => [res.info!, ...prev]);
    setFresh({ channel: res.info.channel, secret: res.secret });
    setName("");
    setSlug("");
  }

  async function toggle(c: WebhookChannelInfo) {
    setBusy(true);
    setError(null);
    const res = await setWebhookChannelEnabled({ tenantId, channelId: c.id, enabled: !c.is_enabled });
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Could not update the channel.");
    setChannels((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_enabled: !c.is_enabled } : x)));
  }

  async function confirm() {
    if (!pending) return;
    const { kind, channel } = pending;
    setBusy(true);
    setError(null);
    if (kind === "rotate") {
      const res = await rotateWebhookSecret({ tenantId, channelId: channel.id });
      setBusy(false);
      setPending(null);
      if (!res.ok || !res.info || !res.secret) return setError(res.error ?? "Could not rotate the secret.");
      setChannels((prev) => prev.map((x) => (x.id === channel.id ? res.info! : x)));
      setFresh({ channel: res.info.channel, secret: res.secret });
    } else {
      const res = await deleteWebhookChannel({ tenantId, channelId: channel.id });
      setBusy(false);
      setPending(null);
      if (!res.ok) return setError(res.error ?? "Could not delete the channel.");
      setChannels((prev) => prev.filter((x) => x.id !== channel.id));
    }
  }

  const signSnippet = fresh
    ? `BODY='{"leadId":"1","phoneNumber":"9876543210","fullName":"Test"}'
TS=$(date +%s)
SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "${fresh.secret}" -hex | sed 's/^.* //')
curl -X POST "${url(fresh.channel)}" \\
  -H "Content-Type: application/json" \\
  -H "X-RD-Timestamp: $TS" -H "X-RD-Signature: sha256=$SIG" \\
  --data-binary "$BODY"`
    : "";

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Inbound lead webhook (push to us)</h2>
          <p className="text-xs text-slate-400">
            Lets this client&apos;s own system POST leads to the CRM, signed with HMAC-SHA256. One channel per sender;
            each has its own secret. Same lead id re-sent = updated, never duplicated.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
            channels.some((c) => c.is_enabled) ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          {channels.filter((c) => c.is_enabled).length
            ? `${channels.filter((c) => c.is_enabled).length} active`
            : "Off"}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {fresh && (
        <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="text-sm font-semibold text-green-800">Channel “{fresh.channel}” — signing secret ✓</p>
          <p className="text-xs text-green-700">
            Send these to the sender over a safe channel. The secret <strong>won&apos;t be shown again</strong>; if it&apos;s lost,
            rotate it to get a new one.
          </p>

          {[
            { label: "Endpoint", value: url(fresh.channel), key: "url" },
            { label: "WEBHOOK_SECRET", value: fresh.secret, key: "secret" },
          ].map((r) => (
            <div key={r.key}>
              <p className="mb-1 text-xs font-medium uppercase text-slate-500">{r.label}</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={r.value}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => copy(r.key, r.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  {copied === r.key ? "Copied ✓" : "Copy"}
                </button>
              </div>
            </div>
          ))}

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium uppercase text-slate-500">Try it (sends one test lead)</p>
              <button
                type="button"
                onClick={() => copy("snippet", signSnippet)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                {copied === "snippet" ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">{signSnippet}</pre>
            <p className="mt-1 text-xs text-slate-500">
              Signature = <span className="font-mono">sha256=</span> + HMAC-SHA256(secret, timestamp + &quot;.&quot; + raw body).
              Timestamp is epoch seconds and must be within 5 minutes of the server.
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
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. RD Interlock relay"
            maxLength={60}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-brand"
          />
        </label>
        <label className="min-w-0 flex-1 text-xs text-slate-500">
          Channel (in the URL)
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="metarelay"
            maxLength={39}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm text-slate-700 outline-none focus:border-brand"
          />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy || !name.trim() || !slug.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Working…" : "Create channel"}
        </button>
      </div>

      {channels.length > 0 && (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {channels.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-700">{c.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      c.is_enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {c.is_enabled ? "active" : "paused"}
                  </span>
                </div>
                <p className="break-all font-mono text-xs text-slate-500">{url(c.channel)}</p>
                <p className="text-xs text-slate-400">
                  Last used {fmt(c.last_used_at)} · secret rotated {fmt(c.secret_rotated_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {c.is_enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  onClick={() => setPending({ kind: "rotate", channel: c })}
                  disabled={busy}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Rotate secret
                </button>
                <button
                  type="button"
                  onClick={() => setPending({ kind: "delete", channel: c })}
                  disabled={busy}
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent deliveries</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead className="bg-slate-50 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Request ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="px-3 py-2 text-slate-500">{fmt(d.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{byId.get(d.channel_id) ?? "—"}</td>
                    <td className={`px-3 py-2 font-medium ${d.http_status < 300 ? "text-green-600" : "text-red-600"}`}>
                      {d.http_status}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {d.error_code
                        ? d.error_code
                        : `${d.created} new · ${d.updated} updated${d.failed ? ` · ${d.failed} failed` : ""}`}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-400">{d.request_id.slice(0, 8)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.kind === "rotate" ? "Rotate this secret?" : "Delete this channel?"}
          message={
            pending.kind === "rotate"
              ? `The current secret for “${pending.channel.channel}” stops verifying immediately. The sender must switch to the new one.`
              : `“${pending.channel.channel}” and its delivery log are removed, and the sender will get 401 errors. Leads it already created are kept.`
          }
          confirmLabel={pending.kind === "rotate" ? "Rotate" : "Delete"}
          danger={pending.kind === "delete"}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
