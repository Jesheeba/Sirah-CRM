"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/auth";

export interface Member {
  id: string;
  email: string | null;
  fullName: string | null;
  role: Role;
}

const ROLES: Role[] = ["Admin", "Manager", "Sales Rep"];

const ROLE_STYLE: Record<Role, string> = {
  Admin: "bg-violet-100 text-violet-700",
  Manager: "bg-blue-100 text-blue-700",
  "Sales Rep": "bg-slate-100 text-slate-600",
};

export default function UsersClient({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Member[]>(members);
  const [error, setError] = useState<string | null>(null);

  async function changeRole(id: string, role: Role) {
    const prev = rows;
    setRows((rs) => rs.map((m) => (m.id === id ? { ...m, role } : m)));
    setError(null);
    const { error } = await supabase.rpc("set_user_role", {
      p_user_id: id,
      p_role: role,
    });
    if (error) {
      setError(error.message);
      setRows(prev);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

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
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLE[m.role]}`}
                      >
                        {m.role}
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.id, e.target.value as Role)}
                        className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLE[m.role]}`}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
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
  );
}
