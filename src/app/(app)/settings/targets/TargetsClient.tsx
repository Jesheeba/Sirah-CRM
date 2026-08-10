"use client";

import { useState, useTransition } from "react";
import { createTarget, updateTarget, deleteTarget } from "./actions";
import { money } from "@/lib/reports";
import type { SalesTarget, TargetMetric } from "@/lib/types";

const METRIC_LABEL: Record<TargetMetric, string> = { revenue: "Revenue", deals_won: "Deals won" };

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function formatTarget(metric: TargetMetric, value: number) {
  return metric === "revenue" ? money(value) : `${value} deal${value === 1 ? "" : "s"}`;
}

function TargetRow({
  target,
  memberName,
  onUpdated,
  onDeleted,
}: {
  target: SalesTarget;
  memberName: string;
  onUpdated: (t: SalesTarget) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(target.target_value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    startTransition(async () => {
      const res = await updateTarget(target.id, value);
      if (!res.ok) return setError(res.error ?? "Failed");
      onUpdated({ ...target, target_value: value });
      setEditing(false);
      setError(null);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete this target?`)) return;
    startTransition(async () => {
      const res = await deleteTarget(target.id);
      if (res.ok) onDeleted(target.id);
      else setError(res.error ?? "Failed");
    });
  }

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-2.5 font-medium text-slate-800">{memberName}</td>
      <td className="px-4 py-2.5 text-slate-600">{periodLabel(target.period)}</td>
      <td className="px-4 py-2.5 text-slate-600">{METRIC_LABEL[target.metric]}</td>
      <td className="px-4 py-2.5">
        {editing ? (
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
            className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand"
          />
        ) : (
          <span className="text-slate-700">{formatTarget(target.metric, target.target_value)}</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {error && <span className="mr-2 text-xs text-red-600">{error}</span>}
        {editing ? (
          <>
            <button onClick={save} disabled={pending} className="mr-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white hover:opacity-90">Save</button>
            <button onClick={() => { setEditing(false); setValue(target.target_value); }} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="mr-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">Edit</button>
            <button onClick={handleDelete} disabled={pending} className="rounded-md border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">Delete</button>
          </>
        )}
      </td>
    </tr>
  );
}

export default function TargetsClient({
  initialTargets,
  members,
}: {
  initialTargets: SalesTarget[];
  members: { id: string; name: string }[];
}) {
  const [targets, setTargets] = useState<SalesTarget[]>(
    [...initialTargets].sort((a, b) => b.period.localeCompare(a.period)),
  );
  const [userId, setUserId] = useState<string>("__team__");
  const [period, setPeriod] = useState(currentPeriod());
  const [metric, setMetric] = useState<TargetMetric>("revenue");
  const [value, setValue] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nameFor = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "Unknown" : "Whole team");

  function handleAdd() {
    if (!(value > 0)) return setError("Enter a target greater than zero.");
    startTransition(async () => {
      const res = await createTarget({ user_id: userId === "__team__" ? null : userId, period, metric, target_value: value });
      if (!res.ok || !res.target) return setError(res.error ?? "Failed");
      setTargets((ts) => [res.target!, ...ts]);
      setValue(0);
      setError(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Rep / Team</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand">
            <option value="__team__">Whole team</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Month</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Metric</label>
          <select value={metric} onChange={(e) => setMetric(e.target.value as TargetMetric)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand">
            <option value="revenue">Revenue</option>
            <option value="deals_won">Deals won</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Target</label>
          <input type="number" min={0} value={value || ""} onChange={(e) => setValue(Number(e.target.value))} placeholder={metric === "revenue" ? "1000000" : "10"} className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-brand" />
        </div>
        <button onClick={handleAdd} disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {pending ? "Adding…" : "Add target"}
        </button>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Rep / Team</th>
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {targets.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No targets set yet.</td></tr>
            )}
            {targets.map((t) => (
              <TargetRow
                key={t.id}
                target={t}
                memberName={nameFor(t.user_id)}
                onUpdated={(updated) => setTargets((ts) => ts.map((x) => (x.id === updated.id ? updated : x)))}
                onDeleted={(id) => setTargets((ts) => ts.filter((x) => x.id !== id))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
