"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { assignInteraction, refreshTaggedPosts, setInteractionIgnored } from "@/app/(app)/social/actions";
import { setReplyMode } from "@/app/(app)/social/reply-actions";
import { SOCIAL_PAGE_SIZE, formatWhen, socialHref, type SocialKind, type SocialQuery, type SocialStatus } from "@/lib/social-list";

export interface SocialItem {
  id: string;
  ig_account_id: string;
  kind: SocialKind;
  author_handle: string | null;
  text: string | null;
  permalink: string | null;
  media_id: string | null;
  created_at_provider: string | null;
  received_at: string;
  status: SocialStatus;
  assigned_to: string | null;
}

const KIND_LABEL: Record<SocialKind, string> = { comment: "Comment", mention: "Mention", tag: "Tagged post", dm: "Message" };
const KIND_STYLE: Record<SocialKind, string> = {
  comment: "bg-sky-100 text-sky-700",
  mention: "bg-violet-100 text-violet-700",
  tag: "bg-amber-100 text-amber-700",
  dm: "bg-emerald-100 text-emerald-700",
};
const STATUS_STYLE: Record<SocialStatus, string> = {
  new: "bg-blue-100 text-blue-700",
  assigned: "bg-amber-100 text-amber-700",
  replied: "bg-green-100 text-green-700",
  ignored: "bg-slate-200 text-slate-600",
  issue: "bg-violet-100 text-violet-700",
  deleted: "bg-red-100 text-red-700",
};

export default function SocialInbox({
  items,
  total,
  query,
  accounts,
  members,
  canManage,
  timeZone,
  isAdmin,
  replyMode,
  allowSelfApprove,
  pendingIds,
  pendingTotal,
}: {
  items: SocialItem[];
  total: number;
  query: SocialQuery;
  accounts: { id: string; username: string | null; status: string }[];
  members: { id: string; full_name: string | null; email: string | null }[];
  canManage: boolean;
  timeZone: string;
  isAdmin: boolean;
  replyMode: "human_approval" | "direct";
  allowSelfApprove: boolean;
  pendingIds: string[];
  pendingTotal: number;
}) {
  const pending = new Set(pendingIds);
  const when = (iso: string | null) => formatWhen(iso, timeZone);
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => setSearch(query.q), [query.q]);

  const go = (over: Partial<SocialQuery>) => startNav(() => router.push(socialHref(query, { page: 1, ...over })));
  const handleOf = (id: string) => accounts.find((a) => a.id === id)?.username;
  const pages = Math.max(1, Math.ceil(total / SOCIAL_PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (query.page - 1) * SOCIAL_PAGE_SIZE + 1;
  const lastRow = Math.min(total, firstRow + items.length - 1);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; stored?: number }>, done?: string) {
    setError(null);
    setNotice(null);
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "Something went wrong.");
    if (done) setNotice(done.replace("{n}", String(res.stored ?? 0)));
    router.refresh();
  }

  if (accounts.length === 0) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold text-slate-800">Social</h1>
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="font-medium text-slate-800">No Instagram account connected yet.</p>
          <p className="mt-1 text-sm text-slate-500">
            Connect one in Settings → Integrations → Instagram. Comments, @mentions, tags and messages will appear here.
          </p>
          <Link href="/settings/integrations" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            Go to Integrations
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800">Social</h1>
          <span className="text-xs text-slate-500">{accounts.map((a) => `@${a.username ?? "account"}`).join(" · ")}</span>
        </div>
        {canManage && (
          <button
            onClick={() => run("refresh", refreshTaggedPosts, "Checked for tagged posts — {n} new.")}
            disabled={busy === "refresh"}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === "refresh" ? "Checking…" : "Refresh tagged posts"}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters">
        <div className="inline-flex flex-wrap rounded-lg border border-slate-200 p-0.5 text-xs">
          {([["", "All types"], ["comment", "Comments"], ["mention", "Mentions"], ["tag", "Tags"], ["dm", "Messages"]] as const).map(([k, label]) => (
            <button
              key={k || "all"}
              onClick={() => go({ kind: k })}
              aria-pressed={query.kind === k}
              className={`rounded-md px-2 py-1 font-medium ${query.kind === k ? "bg-brand text-white" : "text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={query.status}
          onChange={(e) => go({ status: e.target.value as SocialQuery["status"] })}
          aria-label="Filter by status"
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
        >
          <option value="">Needs attention</option>
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="assigned">Assigned</option>
          <option value="replied">Replied</option>
          <option value="issue">Issue created</option>
          <option value="ignored">Ignored</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={query.mine} onChange={(e) => go({ mine: e.target.checked })} />
          Assigned to me
        </label>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: search });
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search text or @handle…"
            aria-label="Search social inbox"
            className="w-52 rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-brand"
          />
        </form>
      </div>

      {(pendingTotal > 0 || isAdmin) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className={pendingTotal ? "font-medium text-amber-800" : "text-slate-500"}>
            {pendingTotal ? `${pendingTotal} repl${pendingTotal === 1 ? "y" : "ies"} waiting for approval` : "No replies waiting for approval"}
          </span>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <label className="flex items-center gap-1">
                Replies:
                <select
                  value={replyMode}
                  disabled={busy === "mode"}
                  onChange={(e) => run("mode", () => setReplyMode(e.target.value as "human_approval" | "direct", allowSelfApprove), "Saved.")}
                  aria-label="How replies are posted"
                  className="rounded-lg border border-slate-200 px-2 py-1"
                >
                  <option value="human_approval">Need approval before posting</option>
                  <option value="direct">Admins/Managers post directly</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={allowSelfApprove}
                  disabled={busy === "mode"}
                  onChange={(e) => run("mode", () => setReplyMode(replyMode, e.target.checked), "Saved.")}
                />
                Writer may approve own reply
              </label>
            </div>
          )}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">Text</th>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Assigned</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                  {query.q || query.kind || query.mine || query.status ? "Nothing matches these filters." : "All caught up — nothing needs attention."}
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[it.kind]}`}>{KIND_LABEL[it.kind]}</span>
                  {accounts.length > 1 && <p className="mt-1 text-xs text-slate-400">to @{handleOf(it.ig_account_id) ?? "?"}</p>}
                </td>
                <td className="px-4 py-3 font-medium text-slate-800">{it.author_handle ? `@${it.author_handle}` : "—"}</td>
                <td className="max-w-md px-4 py-3 text-slate-700">
                  <Link href={`/social/${it.id}`} className="line-clamp-2 hover:text-brand hover:underline">
                    {it.text?.trim() || <span className="italic text-slate-400">(no text)</span>}
                  </Link>
                  {it.permalink && (
                    <a href={it.permalink} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-brand">
                      View on Instagram ↗
                    </a>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{when(it.created_at_provider ?? it.received_at)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[it.status]}`}>{it.status}</span>
                  {pending.has(it.id) && <p className="mt-1 text-xs font-medium text-amber-700">Reply waiting for approval</p>}
                </td>
                <td className="px-4 py-3">
                  {canManage ? (
                    <select
                      value={it.assigned_to ?? ""}
                      disabled={busy === it.id}
                      onChange={(e) => run(it.id, () => assignInteraction(it.id, e.target.value || null))}
                      aria-label={`Assign item from ${it.author_handle ?? "unknown"}`}
                      className="max-w-[10rem] rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-slate-600">
                      {members.find((m) => m.id === it.assigned_to)?.full_name ?? (it.assigned_to ? "Someone" : "—")}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/social/${it.id}`} className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                      Open
                    </Link>
                    {canManage && (it.status === "new" || it.status === "assigned") && (
                      <button
                        onClick={() => run(it.id, () => setInteractionIgnored(it.id, true))}
                        disabled={busy === it.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Ignore
                      </button>
                    )}
                    {canManage && it.status === "ignored" && (
                      <button
                        onClick={() => run(it.id, () => setInteractionIgnored(it.id, false))}
                        disabled={busy === it.id}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500" aria-live="polite">
        <span>{navigating ? "Loading…" : total === 0 ? "0 items" : `${firstRow}–${lastRow} of ${total}`}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button onClick={() => go({ page: query.page - 1 })} disabled={query.page <= 1 || navigating} className="rounded-lg border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40">
              Previous
            </button>
            <span>Page {query.page} of {pages}</span>
            <button onClick={() => go({ page: query.page + 1 })} disabled={query.page >= pages || navigating} className="rounded-lg border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
