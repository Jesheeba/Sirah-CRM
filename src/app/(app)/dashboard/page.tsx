import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { money } from "@/lib/reports";
import StatTile from "@/components/charts/StatTile";
import BarList from "@/components/charts/BarList";
import Donut from "@/components/charts/Donut";
import MiniBars from "@/components/charts/MiniBars";
import TargetProgress, { type TargetProgressItem } from "@/components/charts/TargetProgress";
import type { SalesTarget } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const ctx = (await getUserContext())!;
  const mine = ctx.isRep; // Reps see their own performance; Managers/Admins see org-wide.

  // --- queries (RLS scopes to tenant; owner-scoped for Reps) ----------------
  let dealsQ = supabase
    .from("deals")
    .select("id, amount, currency, status, stage_id, owner_id, closed_at")
    .is("deleted_at", null)
    .limit(5000);
  let leadsQ = supabase
    .from("leads")
    .select("id, status, source, owner_id")
    .is("deleted_at", null)
    .limit(5000);
  let actsQ = supabase.from("activities").select("id, type, owner_id").limit(5000);
  let tOpenQ = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "open");
  let tDoneQ = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "done");
  let tOverdueQ = supabase
    .from("tasks")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "open")
    .lt("due_at", new Date().toISOString());
  let rottenQ = supabase
    .from("deals")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "open")
    .not("rotten_notified_at", "is", null);
  if (mine) {
    dealsQ = dealsQ.eq("owner_id", ctx.userId);
    leadsQ = leadsQ.eq("owner_id", ctx.userId);
    actsQ = actsQ.eq("owner_id", ctx.userId);
    tOpenQ = tOpenQ.eq("assignee_id", ctx.userId);
    tDoneQ = tDoneQ.eq("assignee_id", ctx.userId);
    tOverdueQ = tOverdueQ.eq("assignee_id", ctx.userId);
    rottenQ = rottenQ.eq("owner_id", ctx.userId);
  }

  const now0 = new Date();
  const currentPeriod = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, "0")}`;

  const [pipesRes, stagesRes, dealsRes, leadsRes, actsRes, tOpenRes, tDoneRes, tOverdueRes, rottenRes, profilesRes, targetsRes] =
    await Promise.all([
      supabase.from("pipelines").select("id, is_default").is("deleted_at", null).order("display_order"),
      supabase
        .from("stages")
        .select("id, name, display_order, probability, pipeline_id")
        .order("display_order"),
      dealsQ,
      leadsQ,
      actsQ,
      tOpenQ,
      tDoneQ,
      tOverdueQ,
      rottenQ,
      supabase.from("profiles").select("id, full_name, email"),
      supabase.from("sales_targets").select("*").eq("period", currentPeriod),
    ]);

  const deals = (dealsRes.data ?? []) as any[];
  const leads = (leadsRes.data ?? []) as any[];
  const acts = (actsRes.data ?? []) as any[];
  const stages = (stagesRes.data ?? []) as any[];
  const profiles = (profilesRes.data ?? []) as any[];
  const currency = deals.find((d) => d.currency)?.currency ?? "INR";
  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p ? p.full_name || p.email || "(member)" : "Unassigned";
  };

  // --- metrics --------------------------------------------------------------
  const won = deals.filter((d) => d.status === "won");
  const lost = deals.filter((d) => d.status === "lost");
  const open = deals.filter((d) => d.status === "open");
  const revenue = won.reduce((s, d) => s + Number(d.amount || 0), 0);
  const openValue = open.reduce((s, d) => s + Number(d.amount || 0), 0);
  const winRate = won.length + lost.length > 0 ? won.length / (won.length + lost.length) : 0;

  const totalLeads = leads.length;
  const converted = leads.filter((l) => l.status === "converted").length;

  const probByStage = new Map(stages.map((s) => [s.id, Number(s.probability || 0)]));
  const forecast = open.reduce(
    (s, d) => s + (Number(d.amount || 0) * (probByStage.get(d.stage_id) ?? 0)) / 100,
    0,
  );

  const defaultPipe = pipesRes.data?.find((p) => p.is_default) ?? pipesRes.data?.[0];
  const funnel = stages
    .filter((s) => s.pipeline_id === defaultPipe?.id)
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => {
      const ds = open.filter((d) => d.stage_id === s.id);
      const val = ds.reduce((x, d) => x + Number(d.amount || 0), 0);
      return { label: s.name, value: ds.length, sub: `${ds.length} · ${money(val, currency)}` };
    });

  const group = (rows: any[], key: string, fallback: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[key] || fallback, (m.get(r[key] || fallback) ?? 0) + 1);
    return [...m.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  };
  const leadSources = group(leads, "source", "Unknown").slice(0, 6);
  const activityByType = group(acts, "type", "other");

  const ownerRev = new Map<string, number>();
  for (const d of won) ownerRev.set(d.owner_id || "—", (ownerRev.get(d.owner_id || "—") ?? 0) + Number(d.amount || 0));
  const salesByOwner = [...ownerRev.entries()]
    .map(([id, value]) => ({ label: nameOf(id), value, sub: money(value, currency) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // revenue by month (last 6 months, by closed_at)
  const now = new Date();
  const months: { key: string; label: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleString(undefined, { month: "short" }), value: 0 });
  }
  const monthIdx = new Map(months.map((m, i) => [m.key, i]));
  for (const d of won) {
    if (!d.closed_at) continue;
    const dt = new Date(d.closed_at);
    const idx = monthIdx.get(`${dt.getFullYear()}-${dt.getMonth()}`);
    if (idx != null) months[idx].value += Number(d.amount || 0);
  }

  const tOpen = tOpenRes.count ?? 0;
  const tDone = tDoneRes.count ?? 0;
  const tOverdue = tOverdueRes.count ?? 0;
  const rottenCount = rottenRes.count ?? 0;

  // --- sales targets: progress computed live from `won`, never stored -------
  const wonThisMonth = won.filter((d) => {
    if (!d.closed_at) return false;
    const dt = new Date(d.closed_at);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}` === currentPeriod;
  });
  const achievedFor = (targetUserId: string | null, metric: "revenue" | "deals_won") => {
    const rows = targetUserId === null ? wonThisMonth : wonThisMonth.filter((d) => d.owner_id === targetUserId);
    return metric === "revenue" ? rows.reduce((s, d) => s + Number(d.amount || 0), 0) : rows.length;
  };
  const formatFor = (metric: "revenue" | "deals_won") => (n: number) =>
    metric === "revenue" ? money(n, currency) : `${n} deal${n === 1 ? "" : "s"}`;

  const targets = (targetsRes.data ?? []) as SalesTarget[];
  const myTargetItems: TargetProgressItem[] = (mine ? targets.filter((t) => t.user_id === ctx.userId) : [])
    .map((t) => ({
      label: t.metric === "revenue" ? "Revenue this month" : "Deals won this month",
      achieved: achievedFor(t.user_id, t.metric),
      target: t.target_value,
      formatValue: formatFor(t.metric),
    }));
  const teamTargetItems: TargetProgressItem[] = (!mine ? targets.filter((t) => t.user_id === null) : [])
    .map((t) => ({
      label: t.metric === "revenue" ? "Team revenue this month" : "Team deals won this month",
      achieved: achievedFor(null, t.metric),
      target: t.target_value,
      formatValue: formatFor(t.metric),
    }));
  const repTargetItems: TargetProgressItem[] = (!mine ? targets.filter((t) => t.user_id !== null) : [])
    .map((t) => ({
      label: `${nameOf(t.user_id!)} — ${t.metric === "revenue" ? "revenue" : "deals won"}`,
      achieved: achievedFor(t.user_id, t.metric),
      target: t.target_value,
      formatValue: formatFor(t.metric),
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand">
          {mine ? "Your performance" : `Org-wide · ${ctx.role}`}
        </span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Revenue (won)" value={money(revenue, currency)} sub={`${won.length} deals won`} accent />
        <StatTile label="Weighted forecast" value={money(forecast, currency)} sub={`${open.length} open deals`} />
        <StatTile label="Open pipeline" value={money(openValue, currency)} sub="value of open deals" />
        <Link href="/leads" className="block">
          <StatTile label="Leads" value={String(totalLeads)} sub={`${converted} converted`} />
        </Link>
        <Link href="/tasks" className="block">
          <StatTile label="Overdue tasks" value={String(tOverdue)} sub={tOverdue > 0 ? "need attention" : "all caught up"} />
        </Link>
        <Link href="/deals" className="block">
          <StatTile label="Rotten deals" value={String(rottenCount)} sub={rottenCount > 0 ? "stalled in stage" : "none stalled"} />
        </Link>
      </div>

      {/* Sales targets */}
      {(myTargetItems.length > 0 || teamTargetItems.length > 0 || repTargetItems.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TargetProgress title="Your targets this month" items={myTargetItems} />
          <TargetProgress title="Team targets this month" items={teamTargetItems} />
          {repTargetItems.length > 0 && (
            <div className="lg:col-span-2">
              <TargetProgress title="By rep" items={repTargetItems} />
            </div>
          )}
        </div>
      )}

      {/* Rates */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Donut title="Win rate" value={won.length} total={won.length + lost.length} centerLabel={`${won.length} won / ${lost.length} lost`} color="#16a34a" />
        <Donut title="Lead conversion" value={converted} total={totalLeads} centerLabel={`${converted} of ${totalLeads} leads`} />
        <Donut title="Task completion" value={tDone} total={tOpen + tDone} centerLabel={`${tDone} done / ${tOpen} open`} color="#d97706" />
      </div>

      {/* Pipeline + revenue trend */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList title="Pipeline funnel (open deals by stage)" items={funnel} empty="No open deals." />
        <MiniBars title="Revenue by month (won)" items={months} valueFormat={(n) => money(n, currency)} />
      </div>

      {/* Sources + activities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarList title="Lead sources" items={leadSources} empty="No leads yet." />
        <BarList title="Activities by type" items={activityByType} empty="No activities logged." />
      </div>

      {/* Sales performance */}
      <BarList
        title={mine ? "Your won revenue" : "Sales performance (won revenue by owner)"}
        items={salesByOwner}
        empty="No won deals yet."
      />
    </div>
  );
}
