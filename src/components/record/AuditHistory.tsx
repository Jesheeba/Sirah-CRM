import { createClient } from "@/lib/supabase/server";

interface AuditLogRow {
  id: number;
  actor_id: string | null;
  action: "insert" | "update" | "delete";
  changes: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

// Internal/noisy columns not worth surfacing in a human-facing history.
const SKIP_FIELDS = new Set(["updated_at", "updated_by", "version", "custom_fields"]);

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtWhen(at: string) {
  try { return new Date(at).toLocaleString(); } catch { return at; }
}

function prettifyField(k: string) {
  return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Reads fn_audit()'s existing before/after diffs (0003) — that data has always been
 * captured; this is the first UI to surface it per-record. Server component, read-only.
 */
export default async function AuditHistory({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("audit_logs")
    .select("id, actor_id, action, changes, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(25);

  const rows = (data ?? []) as AuditLogRow[];
  if (!rows.length) return null;

  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((id): id is string => !!id)));
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id, (p as { full_name: string | null; email: string | null }).full_name || p.email || "Someone"]),
  );
  const actorName = (id: string | null) => (id ? nameById.get(id) ?? "Someone" : "System");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">History</h3>
      <ul className="space-y-3">
        {rows.map((r) => {
          const fields = r.changes
            ? Object.entries(r.changes).filter(([k]) => !SKIP_FIELDS.has(k))
            : [];
          return (
            <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0">
              <p className="text-xs text-slate-400">
                <span className="font-medium text-slate-600">{actorName(r.actor_id)}</span>{" "}
                {r.action === "insert" ? "created this record" : r.action === "delete" ? "deleted this record" : "made changes"}
                {" · "}
                {fmtWhen(r.created_at)}
              </p>
              {r.action === "update" && fields.length > 0 && (
                <ul className="mt-1 space-y-0.5 pl-2 text-sm text-slate-700">
                  {fields.map(([field, { old, new: next }]) => (
                    <li key={field}>
                      <span className="text-slate-500">{prettifyField(field)}:</span>{" "}
                      <span className="text-slate-400 line-through">{fmtVal(old)}</span>{" "}
                      → <span className="font-medium">{fmtVal(next)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
