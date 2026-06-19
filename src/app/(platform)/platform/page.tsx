import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/platform-guard";
import { timeAgo, type PlatformOverview } from "@/lib/platform";
import StatTile from "@/components/charts/StatTile";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-amber-100 text-amber-700",
};

export default async function PlatformDashboard() {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_platform_overview");
  const o = (data ?? {}) as Partial<PlatformOverview>;

  const n = (v: number | undefined) => (v ?? 0).toLocaleString();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Platform overview</h1>
        <p className="text-sm text-slate-500">Aggregate health of every organization on the platform.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total tenants" value={n(o.tenants_total)} accent />
        <StatTile label="Active" value={n(o.tenants_active)} sub="operational" />
        <StatTile label="Suspended" value={n(o.tenants_suspended)} sub="blocked from app" />
        <StatTile label="Platform users" value={n(o.users_total)} sub="across all tenants" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Leads" value={n(o.leads_total)} />
        <StatTile label="Contacts" value={n(o.contacts_total)} />
        <StatTile label="Deals" value={n(o.deals_total)} />
        <StatTile label="New tenants (30d)" value={n(o.signups_30d)} sub={`${n(o.signups_7d)} in last 7 days`} accent />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Recent registrations</h2>
          <Link href="/platform/tenants" className="text-xs font-medium text-brand hover:underline">
            View all tenants →
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {(o.recent_tenants ?? []).length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-400">No tenants yet.</p>
          )}
          {(o.recent_tenants ?? []).map((t) => (
            <Link
              key={t.id}
              href={`/platform/tenants/${t.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-700">{t.name}</div>
                <div className="font-mono text-xs text-slate-400">{t.slug}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-slate-400 sm:block">{timeAgo(t.created_at)}</span>
                <span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${STATUS_STYLE[t.status] ?? ""}`}>
                  {t.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
