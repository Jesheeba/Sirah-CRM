import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { REPORT_DEFS, REPORT_TYPES, money, type ReportColumn } from "@/lib/reports";
import type { ReportType } from "@/lib/types";
import ReportPrintActions from "@/components/reports/ReportPrintActions";

function memberName(m: { full_name: string | null; email: string | null } | undefined) {
  if (!m) return "—";
  return m.full_name || m.email || "(member)";
}

function cellText(
  col: ReportColumn,
  row: Record<string, unknown>,
  memberById: Map<string, { full_name: string | null; email: string | null }>,
): string {
  if (col.compute) return col.compute(row);
  const raw = row[col.key];
  if (col.kind === "member") return memberName(memberById.get(String(raw ?? "")));
  if (col.kind === "currency") return raw != null ? money(Number(raw), String(row.currency || "INR")) : "";
  if (col.kind === "date") return raw ? new Date(String(raw)).toLocaleDateString() : "";
  return raw == null || raw === "" ? "" : String(raw);
}

export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const type = (REPORT_TYPES.includes(params.type as ReportType) ? params.type : "leads") as ReportType;
  const def = REPORT_DEFS[type];
  const from = params.from ?? "";
  const to = params.to ?? "";
  let filters: Record<string, string> = {};
  try {
    filters = params.filters ? JSON.parse(params.filters) : {};
  } catch {
    filters = {};
  }

  const supabase = await createClient();
  const ctx = (await getUserContext())!;
  const canSeeAll = ctx.isManager || ctx.isAdmin;

  let q = supabase.from(def.table).select(def.select);
  if (def.hasDeletedAt) q = q.is("deleted_at", null);
  if (def.baseFilter) for (const [k, v] of Object.entries(def.baseFilter)) q = q.eq(k, v);
  for (const [k, v] of Object.entries(filters)) if (v) q = q.eq(k, v);
  if (from) q = q.gte(def.dateField, from);
  if (to) q = q.lte(def.dateField, `${to}T23:59:59`);
  if (!canSeeAll) q = q.eq(def.ownerField, ctx.userId);
  q = q.order(def.dateField, { ascending: false }).limit(1000);

  const [{ data: rows }, { data: membersData }] = await Promise.all([
    q,
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const memberById = new Map(
    ((membersData ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((m) => [m.id, m]),
  );

  const data = (rows ?? []) as unknown as Record<string, unknown>[];
  const total = def.sumField ? data.reduce((s, r) => s + Number(r[def.sumField!] ?? 0), 0) : null;

  return (
    <div className="mx-auto max-w-4xl p-6 print:p-0">
      <ReportPrintActions />
      <div className="rounded-xl border border-slate-200 bg-white p-6 print:border-0 print:p-0 print:shadow-none">
        <h1 className="text-xl font-bold text-slate-800">{def.label} Report</h1>
        <p className="mt-1 text-sm text-slate-500">
          {from || to ? `${def.dateLabel} ${from || "…"} to ${to || "…"}` : "All time"}
          {" · "}
          Generated {new Date().toLocaleString()}
          {!canSeeAll && " · Your records only"}
        </p>
        {total != null && (
          <p className="mt-2 text-sm font-semibold text-slate-700">
            Total: <span className="text-brand">{money(total, String(data[0]?.currency || "INR"))}</span>
          </p>
        )}

        <table className="mt-4 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className="px-2 py-2">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.length === 0 && (
              <tr><td colSpan={def.columns.length} className="px-2 py-8 text-center text-slate-400">No results.</td></tr>
            )}
            {data.map((r) => (
              <tr key={String(r.id)}>
                {def.columns.map((c) => (
                  <td key={c.key} className="px-2 py-2 text-slate-700">{cellText(c, r, memberById) || "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
