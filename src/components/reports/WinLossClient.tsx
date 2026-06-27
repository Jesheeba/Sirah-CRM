"use client";

import { useState } from "react";
import type { WinLossReport } from "@/app/(app)/reports/win-loss/page";

function StatCard({
  label,
  value,
  sub,
  color = "text-slate-800",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function fmt(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export default function WinLossClient({
  initialData,
  defaultFrom,
  defaultTo,
}: {
  initialData: WinLossReport | null;
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo]     = useState(defaultTo);
  const [data, setData] = useState<WinLossReport | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  async function load(f: string, t: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/win-loss?from=${f}&to=${t}`);
      const json = await res.json() as WinLossReport | { error: string };
      if ("error" in json) { setError(json.error); }
      else setData(json);
    } catch {
      setError("Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  const s = data?.summary;
  const reasons = data?.reasons ?? [];
  const byOwner = data?.by_owner ?? [];
  const maxReasonCount = Math.max(...reasons.map((r) => r.count), 1);

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </div>
        <button
          onClick={() => void load(from, to)}
          disabled={loading}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Apply"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* Summary cards */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Won" value={s.won} color="text-green-700" />
          <StatCard label="Lost" value={s.lost} color="text-rose-700" />
          <StatCard label="Total closed" value={s.total} />
          <StatCard
            label="Win rate"
            value={s.win_rate !== null ? `${s.win_rate}%` : "—"}
            color={s.win_rate !== null && s.win_rate >= 50 ? "text-green-700" : "text-rose-700"}
          />
          <StatCard
            label="Value won"
            value={`₹${fmt(s.value_won)}`}
            color="text-green-700"
          />
          <StatCard
            label="Value lost"
            value={`₹${fmt(s.value_lost)}`}
            color="text-rose-700"
          />
        </div>
      )}

      {!s && !loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          No closed deals found in this date range.
        </div>
      )}

      {/* Loss reasons */}
      {reasons.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Loss Reasons</h2>
          <div className="space-y-3">
            {reasons.map((r) => {
              const pct = s?.lost ? Math.round((r.count / s.lost) * 100) : 0;
              const barW = Math.round((r.count / maxReasonCount) * 100);
              return (
                <div key={r.reason}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{r.reason}</span>
                    <span className="text-slate-500">
                      {r.count} deal{r.count !== 1 ? "s" : ""} ({pct}%) · ₹{fmt(r.value)} lost
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-rose-400"
                      style={{ width: `${barW}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* By owner */}
      {byOwner.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Win Rate by Rep</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="pb-2 text-left font-medium">Rep</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Lost</th>
                  <th className="pb-2 text-right font-medium">Win rate</th>
                  <th className="pb-2 text-right font-medium">Value won</th>
                </tr>
              </thead>
              <tbody>
                {byOwner.map((o) => (
                  <tr key={o.owner_id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 font-medium text-slate-700">{o.owner_name}</td>
                    <td className="py-2 text-right text-green-700">{o.won}</td>
                    <td className="py-2 text-right text-rose-700">{o.lost}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`font-semibold ${
                          o.win_rate !== null && o.win_rate >= 50
                            ? "text-green-700"
                            : "text-rose-600"
                        }`}
                      >
                        {o.win_rate !== null ? `${o.win_rate}%` : "—"}
                      </span>
                    </td>
                    <td className="py-2 text-right text-slate-600">₹{fmt(o.value_won)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
