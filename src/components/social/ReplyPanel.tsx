"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveReply, rejectReply, retryReply, submitReply } from "@/app/(app)/social/reply-actions";
import type { ReplyChannel } from "@/lib/ig-reply";

export interface ReplyRow {
  id: string;
  channel: ReplyChannel;
  body: string;
  status: "pending_approval" | "approved" | "sent" | "rejected" | "failed";
  drafted_by: string | null;
  approved_by: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

const CHANNEL_LABEL: Record<ReplyChannel, string> = {
  public: "Public reply",
  private: "Private reply (DM to the commenter)",
  dm: "Message",
};
const STATUS: Record<ReplyRow["status"], [string, string]> = {
  pending_approval: ["Waiting for approval", "bg-amber-100 text-amber-800"],
  approved: ["Sending…", "bg-sky-100 text-sky-700"],
  sent: ["Sent", "bg-green-100 text-green-700"],
  rejected: ["Rejected", "bg-slate-200 text-slate-600"],
  failed: ["Failed", "bg-red-100 text-red-700"],
};
const LIMIT: Record<ReplyChannel, number> = { public: 2200, private: 1000, dm: 1000 };

export default function ReplyPanel({
  interactionId,
  channels,
  blocked,
  replies,
  names,
  me,
  canManage,
  mode,
  allowSelfApprove,
  formatWhen,
}: {
  interactionId: string;
  /** Channels this item can be answered on. */
  channels: ReplyChannel[];
  /** Per channel: why Instagram would refuse it right now (time window), if so. */
  blocked: Partial<Record<ReplyChannel, string>>;
  replies: ReplyRow[];
  names: Record<string, string>;
  me: string;
  canManage: boolean;
  mode: "human_approval" | "direct";
  allowSelfApprove: boolean;
  formatWhen: Record<string, string>;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<ReplyChannel | undefined>(channels[0]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sendsNow = mode === "direct" && canManage;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string; status?: string }>, ok?: string) {
    setError(null);
    setNotice(null);
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else if (ok) setNotice(ok);
    router.refresh();
    return res.ok;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!channel) return;
    const ok = await run("submit", () => submitReply({ interactionId, channel, body }), sendsNow ? "Reply sent to Instagram." : "Sent for approval.");
    if (ok) setBody("");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="reply-title" id="reply">
      <h2 id="reply-title" className="text-sm font-semibold text-slate-700">Reply</h2>

      {replies.length > 0 && (
        <ol className="mt-3 space-y-3">
          {replies.map((r) => {
            const [label, style] = STATUS[r.status];
            const mayApprove = canManage && r.status === "pending_approval" && (allowSelfApprove || r.drafted_by !== me);
            return (
              <li key={r.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${style}`}>{label}</span>
                  <span>{CHANNEL_LABEL[r.channel]}</span>
                  <span>· by {names[r.drafted_by ?? ""] ?? "someone"} · {formatWhen[r.id]}</span>
                  {r.approved_by && <span>· approved by {names[r.approved_by] ?? "someone"}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-slate-800">{r.body}</p>
                {r.status === "failed" && r.error && <p className="mt-1 text-xs text-red-700">{r.error}</p>}
                {(mayApprove || (canManage && r.status === "pending_approval") || (canManage && r.status === "failed")) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mayApprove && (
                      <button
                        onClick={() => run(r.id, () => approveReply(r.id), "Approved and sent.")}
                        disabled={busy !== null}
                        className="rounded-lg bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {busy === r.id ? "Sending…" : "Approve & send"}
                      </button>
                    )}
                    {canManage && r.status === "pending_approval" && (
                      <button
                        onClick={() => run(r.id + "-x", () => rejectReply(r.id), "Rejected — it will not be sent.")}
                        disabled={busy !== null}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50"
                      >
                        Reject
                      </button>
                    )}
                    {canManage && r.status === "pending_approval" && !mayApprove && (
                      <span className="self-center text-xs text-slate-500">Another admin or manager must approve this.</span>
                    )}
                    {canManage && r.status === "failed" && (
                      <button
                        onClick={() => run(r.id + "-r", () => retryReply(r.id), "Back in the approval queue.")}
                        disabled={busy !== null}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {channels.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Instagram doesn&apos;t allow replying to this kind of item.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          {channels.length > 1 && (
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Reply as</legend>
              {channels.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-slate-700">
                  <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} />
                  {CHANNEL_LABEL[c]}
                </label>
              ))}
            </fieldset>
          )}
          {channel && blocked[channel] && (
            <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{blocked[channel]}</p>
          )}
          <label className="block">
            <span className="sr-only">Reply text</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={channel ? LIMIT[channel] : undefined}
              placeholder="Write the reply…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              {[...body].length}/{channel ? LIMIT[channel] : "—"} ·{" "}
              {sendsNow ? "Posts to Instagram immediately." : "An admin or manager approves it before it is posted."}
            </span>
            <button
              type="submit"
              disabled={busy !== null || !body.trim() || !channel || Boolean(channel && blocked[channel])}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "submit" ? "Saving…" : sendsNow ? "Send" : "Send for approval"}
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
    </section>
  );
}
