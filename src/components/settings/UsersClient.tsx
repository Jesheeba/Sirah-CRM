"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendInvite, cancelInvite } from "@/app/(app)/settings/users/invite-actions";
import type { Role } from "@/lib/auth";

export interface Member {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

export interface PendingInvite {
  id: string;
  email: string;
  roleName: string;
  expiresAt: string;
}

const ROLES: Role[] = ["Admin", "Manager", "Sales Rep"];

const ROLE_STYLE: Record<string, string> = {
  Admin: "bg-violet-100 text-violet-700",
  Manager: "bg-blue-100 text-blue-700",
  "Sales Rep": "bg-slate-100 text-slate-600",
};

// ── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Sales Rep");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLink(null);
    startTransition(async () => {
      const res = await sendInvite(email, role);
      if (res.ok && res.link) {
        setLink(res.link);
      } else {
        setError(res.error ?? "Failed to create invitation.");
      }
    });
  }

  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Invite team member</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        {!link ? (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Email address</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@example.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending ? "Generating…" : "Generate invite link"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Share this link with <span className="font-medium">{email}</span>. It expires in 7 days.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <span className="flex-1 truncate text-xs font-mono text-slate-700">{link}</span>
              <button
                onClick={copy}
                className="shrink-0 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white hover:opacity-90"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              They will set their own name and password when they open the link.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsersClient({
  members,
  currentUserId,
  pendingInvites,
}: {
  members: Member[];
  currentUserId: string;
  pendingInvites: PendingInvite[];
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Member[]>(members);
  const [invites, setInvites] = useState<PendingInvite[]>(pendingInvites);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  async function changeRole(id: string, role: Role) {
    const prev = rows;
    setRows((rs) => rs.map((m) => (m.id === id ? { ...m, role } : m)));
    setError(null);
    const { error } = await supabase.rpc("set_user_role", { p_user_id: id, p_role: role });
    if (error) {
      setError(error.message);
      setRows(prev);
    }
  }

  async function handleCancelInvite(id: string) {
    setCancelling(id);
    const res = await cancelInvite(id);
    setCancelling(null);
    if (res.ok) {
      setInvites((prev) => prev.filter((inv) => inv.id !== id));
    } else {
      setError(res.error ?? "Failed to cancel.");
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Active members */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Team members</h2>
          <button
            onClick={() => setShowInvite(true)}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            + Invite member
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((m) => {
                const isSelf = m.id === currentUserId;
                return (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {m.fullName || "—"}
                      {isSelf && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{m.email ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLE[m.role]}`}>
                          {m.role}
                        </span>
                      ) : (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.id, e.target.value as Role)}
                          className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLE[m.role]}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">
          You can&apos;t change your own role (prevents locking yourself out). Role changes apply on the
          user&apos;s next page load.
        </p>
      </div>

      {/* Pending invitations */}
      {invites.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Pending invitations</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invites.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{inv.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLE[inv.roleName] ?? "bg-slate-100 text-slate-600"}`}>
                        {inv.roleName}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        disabled={cancelling === inv.id}
                        onClick={() => handleCancelInvite(inv.id)}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {cancelling === inv.id ? "Cancelling…" : "Cancel"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => {
            setShowInvite(false);
          }}
        />
      )}
    </div>
  );
}
