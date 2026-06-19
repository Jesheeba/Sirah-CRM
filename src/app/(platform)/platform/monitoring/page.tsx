import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { timeAgo, type PlatformMonitoring, type PlatformActivity } from "@/lib/platform";
import StatTile from "@/components/charts/StatTile";

const HEALTH_DOT = (lastActivity: string | null, status: string) => {
  if (status === "suspended") return "bg-amber-400";
  if (!lastActivity) return "bg-slate-300";
  const days = (Date.now() - new Date(lastActivity).getTime()) / 86400000;
  if (days < 7) return "bg-green-500";
  if (days < 30) return "bg-amber-400";
  return "bg-red-400";
};

export default async function MonitoringPage() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: mon }, { data: act }] = await Promise.all([
    supabase.rpc("admin_monitoring"),
    supabase.rpc("admin_recent_activity", { p_limit: 20 }),
  ]);
  const m = (mon ?? {}) as Partial<PlatformMonitoring>;
  const activity = (act ?? []) as PlatformActivity[];
  const jobs = m.jobs ?? { queued: 0, running: 0, failed: 0 };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Monitoring</h1>
        <p className="text-sm text-slate-500">System status, integration health, background jobs and activity.</p>
      </div>

      {/* System status */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Database</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-bold text-slate-800">
            <span className={`h-2.5 w-2.5 rounded-full ${m.db_ok ? "bg-green-500" : "bg-red-500"}`} />
            {m.db_ok ? "Operational" : "Down"}
          </div>
        </div>
        <StatTile label="Email integrations" value={String(m.integrations?.email_enabled ?? 0)} sub="tenants enabled" />
        <StatTile label="WhatsApp integrations" value={String(m.integrations?.whatsapp_enabled ?? 0)} sub="tenants enabled" />
        <StatTile
          label="Failed jobs"
          value={String(jobs.failed)}
          sub={`${jobs.queued} queued · ${jobs.running} running`}
          accent={jobs.failed > 0}
        />
      </div>

      {/* Tenant health */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Tenant health</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2"></th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2 text-right">Users</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(m.tenant_health ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No tenants.</td></tr>
              )}
              {(m.tenant_health ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${HEALTH_DOT(t.last_activity, t.status)}`} />
                  </td>
                  <td className="px-4 py-2 text-slate-700">{t.name}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{t.users}</td>
                  <td className="px-4 py-2 capitalize text-slate-500">{t.status}</td>
                  <td className="px-4 py-2 text-slate-500">{timeAgo(t.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Background jobs */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Background jobs</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {(m.recent_jobs ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                No jobs yet. Billing &amp; AI modules will queue jobs here.
              </p>
            )}
            {(m.recent_jobs ?? []).map((j) => (
              <div key={j.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-700">{j.kind}</span>
                <span className="text-slate-400">{j.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent platform activity */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Recent platform activity</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {activity.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No platform actions logged yet.</p>
            )}
            {activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-slate-700">{a.action}</div>
                  <div className="truncate text-xs text-slate-400">{a.actor_email ?? "system"}</div>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
