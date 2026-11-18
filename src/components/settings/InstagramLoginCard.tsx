"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectIgAccount } from "@/app/(app)/settings/integrations/ig-login-actions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export interface IgAccountInfo {
  id: string;
  ig_user_id: string;
  username: string | null;
  account_type: string | null;
  status: "active" | "expired" | "revoked";
  webhook_subscribed: boolean;
  token_expires_at: string | null;
}

const REASONS: Record<string, string> = {
  unconfigured: "Instagram connection is not set up on the server yet (META_APP_ID / META_APP_SECRET / IG_CONFIG_ID).",
  denied: "You cancelled or denied the Instagram permission.",
  state: "Security check failed. Please try connecting again.",
  noaccount: "No Instagram account was shared. Connect again and select your Instagram Business or Creator account.",
  taken: "That Instagram account is already connected to another organization.",
  save: "Couldn't save the account. Please try again.",
  oauth: "Instagram sign-in failed. Please try again.",
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Connect an Instagram professional account with no Facebook Page (Instagram Login). */
export default function InstagramLoginCard({
  accounts,
  configured,
  notice,
  reason,
  subscribed,
}: {
  accounts: IgAccountInfo[];
  configured: boolean;
  notice: string | null;
  reason: string | null;
  subscribed: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<IgAccountInfo | null>(null);
  const live = accounts.filter((a) => a.status !== "revoked");

  async function disconnect() {
    if (!confirm) return;
    setError(null);
    setBusy(true);
    const res = await disconnectIgAccount(confirm.ig_user_id);
    setBusy(false);
    setConfirm(null);
    if (!res.ok) setError(res.error ?? "Could not disconnect.");
    else router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-labelledby="ig-login-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ig-login-title" className="text-base font-semibold text-slate-800">
            Instagram (comments, mentions &amp; messages)
          </h2>
          <p className="text-sm text-slate-500">
            Sign in with Instagram or Facebook — no Facebook Page needed. Works with Business and Creator accounts, and gets comments, @mentions and messages.
          </p>
        </div>
        {configured ? (
          <a
            href="/api/ig/oauth/start"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            {live.length ? "Connect another account" : "Connect Instagram"}
          </a>
        ) : (
          <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {REASONS.unconfigured}
          </span>
        )}
      </div>

      {notice === "connected" && (
        <p role="status" className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Instagram connected.
          {subscribed === "0" && " Live updates could not be switched on yet — reconnect to retry."}
        </p>
      )}
      {notice === "error" && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {REASONS[reason ?? ""] ?? "Couldn't connect Instagram."}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {live.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
          {live.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">@{a.username ?? a.ig_user_id}</p>
                <p className="text-xs text-slate-500">
                  {a.status === "expired" ? (
                    <span className="font-medium text-red-600">Expired — reconnect to resume</span>
                  ) : (
                    <>
                      Active · token valid until {fmtDate(a.token_expires_at)} (renews automatically)
                    </>
                  )}
                  {a.status === "active" && !a.webhook_subscribed && (
                    <span className="ml-2 text-amber-600">· live updates off — reconnect</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setConfirm(a)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title="Disconnect this Instagram account?"
          message={`@${confirm.username ?? confirm.ig_user_id} will stop sending comments, mentions and messages to the CRM. Existing history is kept.`}
          confirmLabel="Disconnect"
          busy={busy}
          onConfirm={disconnect}
          onCancel={() => setConfirm(null)}
        />
      )}
    </section>
  );
}
