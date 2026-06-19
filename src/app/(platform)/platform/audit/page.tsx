import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { type PlatformActivity } from "@/lib/platform";

const ACTION_STYLE: Record<string, string> = {
  "tenant.suspend": "bg-amber-100 text-amber-700",
  "tenant.reactivate": "bg-green-100 text-green-700",
  "tenant.provision": "bg-brand-50 text-brand",
  "settings.update": "bg-slate-100 text-slate-600",
  "feature_flag.update": "bg-purple-100 text-purple-700",
};

export default async function PlatformAuditPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_recent_activity", { p_limit: 200 });
  const rows = (data ?? []) as PlatformActivity[];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Platform audit logs</h1>
        <p className="text-sm text-slate-500">Every privileged platform action, most recent first.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No platform actions logged yet.</td></tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500">{new Date(a.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-slate-600">{a.actor_email ?? "system"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${ACTION_STYLE[a.action] ?? "bg-slate-100 text-slate-600"}`}>
                    {a.action}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {a.target_type ?? "—"}{a.target_id ? `:${a.target_id.slice(0, 8)}` : ""}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {a.detail ? JSON.stringify(a.detail) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
