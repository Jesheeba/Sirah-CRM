"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Member } from "@/components/tasks/TasksClient";
import {
  REPORT_DEFS,
  REPORT_TYPES,
  money,
  toCsv,
  type ReportColumn,
} from "@/lib/reports";
import type { ReportType, SavedReport } from "@/lib/types";

function memberName(m: Member | undefined) {
  if (!m) return "—";
  return m.full_name || m.email || "(member)";
}

function badgeClass(v: string) {
  switch (v) {
    case "won":
    case "done":
    case "qualified":
    case "converted":
      return "bg-green-100 text-green-700";
    case "lost":
    case "unqualified":
    case "high":
      return "bg-rose-100 text-rose-700";
    case "open":
    case "new":
    case "normal":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

type RunArgs = {
  type?: ReportType;
  from?: string;
  to?: string;
  filters?: Record<string, string>;
};

export default function ReportsClient({
  members,
  savedReports,
  userId,
  canSeeAll,
}: {
  members: Member[];
  savedReports: SavedReport[];
  userId: string;
  canSeeAll: boolean;
}) {
  const supabase = createClient();
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const [type, setType] = useState<ReportType>("leads");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>(savedReports);
  const [saveName, setSaveName] = useState("");

  const def = REPORT_DEFS[type];

  function cellText(col: ReportColumn, row: Record<string, any>): string {
    if (col.compute) return col.compute(row);
    const raw = row[col.key];
    if (col.kind === "member") return memberName(memberById.get(raw ?? ""));
    if (col.kind === "currency")
      return raw != null ? money(Number(raw), row.currency || "INR") : "";
    if (col.kind === "date") return raw ? new Date(raw).toLocaleDateString() : "";
    return raw == null || raw === "" ? "" : String(raw);
  }

  async function run(override?: RunArgs) {
    const t = override?.type ?? type;
    const f = override?.from ?? from;
    const to2 = override?.to ?? to;
    const flt = override?.filters ?? filters;
    const d = REPORT_DEFS[t];

    setLoading(true);
    setError(null);
    let q = supabase.from(d.table).select(d.select);
    if (d.hasDeletedAt) q = q.is("deleted_at", null);
    if (d.baseFilter) for (const [k, v] of Object.entries(d.baseFilter)) q = q.eq(k, v);
    for (const [k, v] of Object.entries(flt)) if (v) q = q.eq(k, v);
    if (f) q = q.gte(d.dateField, f);
    if (to2) q = q.lte(d.dateField, `${to2}T23:59:59`);
    if (!canSeeAll) q = q.eq(d.ownerField, userId);
    q = q.order(d.dateField, { ascending: false }).limit(1000);

    const { data, error } = await q;
    setLoading(false);
    setRan(true);
    if (error) {
      setError(error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as Record<string, any>[]);
  }

  function switchType(t: ReportType) {
    setType(t);
    setFilters({});
    setRows([]);
    setRan(false);
    setError(null);
  }

  function exportCsv() {
    const headers = def.columns.map((c) => c.label);
    const data = rows.map((r) => def.columns.map((c) => cellText(c, r)));
    const csv = toCsv(headers, data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveReport() {
    if (!saveName.trim()) return setError("Name the report to save it.");
    setError(null);
    const { data, error } = await supabase
      .from("saved_reports")
      .insert({ name: saveName.trim(), report_type: type, config: { from, to, filters } })
      .select("*")
      .single();
    if (error) return setError(error.message);
    setSaved((s) => [data as SavedReport, ...s]);
    setSaveName("");
  }

  function loadSaved(r: SavedReport) {
    const cfg = r.config ?? {};
    setType(r.report_type);
    setFrom(cfg.from ?? "");
    setTo(cfg.to ?? "");
    setFilters(cfg.filters ?? {});
    run({ type: r.report_type, from: cfg.from ?? "", to: cfg.to ?? "", filters: cfg.filters ?? {} });
  }

  async function deleteSaved(id: string) {
    const prev = saved;
    setSaved((s) => s.filter((r) => r.id !== id));
    const { error } = await supabase.from("saved_reports").delete().eq("id", id);
    if (error) {
      setError(error.message);
      setSaved(prev);
    }
  }

  const total = def.sumField
    ? rows.reduce((sum, r) => sum + Number(r[def.sumField!] ?? 0), 0)
    : null;
  const savedForType = saved.filter((r) => r.report_type === type);

  return (
    <div className="space-y-4">
      {/* Report-type tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {REPORT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => switchType(t)}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
              type === t ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {REPORT_DEFS[t].label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-500">
          {def.dateLabel} from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs text-slate-500">
          {def.dateLabel} to
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>
        {def.filters.map((f) => (
          <label key={f.key} className="text-xs text-slate-500">
            {f.label}
            <select
              value={filters[f.key] ?? ""}
              onChange={(e) => setFilters((x) => ({ ...x, [f.key]: e.target.value }))}
              className="mt-0.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm capitalize outline-none focus:border-brand"
            >
              <option value="">Any</option>
              {f.type === "member"
                ? members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberName(m)}
                    </option>
                  ))
                : (f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
            </select>
          </label>
        ))}
        <div className="flex items-end">
          <button
            onClick={() => run()}
            disabled={loading}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Running…" : "Run report"}
          </button>
        </div>
      </div>

      {/* Summary + actions */}
      {ran && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-slate-600">
              <span className="font-bold text-slate-800">{rows.length}</span> result(s)
            </span>
            {total != null && (
              <span className="text-slate-600">
                Total:{" "}
                <span className="font-bold text-brand">
                  {money(total, rows[0]?.currency || "INR")}
                </span>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Save as…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand"
            />
            <button
              onClick={saveReport}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Save report
            </button>
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {ran && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {def.columns.map((c) => (
                  <th key={c.key} className="px-4 py-3">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={def.columns.length} className="px-4 py-10 text-center text-slate-400">
                    No results for these filters.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  {def.columns.map((c) => {
                    const text = cellText(c, r);
                    return (
                      <td key={c.key} className="px-4 py-3 text-slate-700">
                        {c.kind === "status" && text ? (
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${badgeClass(text)}`}
                          >
                            {text}
                          </span>
                        ) : (
                          text || <span className="text-slate-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Saved reports for this type */}
      {savedForType.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Saved {def.label} reports</h2>
          <ul className="divide-y divide-slate-100">
            {savedForType.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <button onClick={() => loadSaved(r)} className="font-medium text-brand hover:underline">
                  {r.name}
                </button>
                <button
                  onClick={() => deleteSaved(r.id)}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
