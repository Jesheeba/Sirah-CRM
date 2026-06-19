import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditableFields from "@/components/record/EditableFields";
import RecordTimeline from "@/components/record/RecordTimeline";
import LeadConvert from "@/components/leads/LeadConvert";
import { customFieldDefsFor } from "@/lib/customFields";
import { LEAD_STATUSES, type TimelineItem } from "@/lib/types";

function RelatedCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function leadName(l: {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
}) {
  const n = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim();
  return n || l.company || "(no name)";
}

export default async function LeadDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!lead) notFound();

  const [notesRes, actsRes, tasksRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("related_to_type", "lead")
      .eq("related_to_id", id),
    supabase
      .from("activities")
      .select("id, subject, type, occurred_at")
      .eq("related_to_type", "lead")
      .eq("related_to_id", id),
    supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .eq("related_to_type", "lead")
      .eq("related_to_id", id)
      .is("deleted_at", null),
  ]);

  const items: TimelineItem[] = [
    ...((notesRes.data ?? []) as any[]).map((n) => ({
      id: n.id, kind: "note" as const, text: n.body, at: n.created_at,
    })),
    ...((actsRes.data ?? []) as any[]).map((a) => ({
      id: a.id, kind: "activity" as const, text: a.subject ?? a.type, meta: a.type, at: a.occurred_at,
    })),
    ...((tasksRes.data ?? []) as any[]).map((t) => ({
      id: t.id, kind: "task" as const, text: t.title, meta: t.status, at: t.created_at,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const name = leadName(lead);
  const customFields = await customFieldDefsFor(supabase, "leads");

  // Show any captured answers that aren't backed by a defined custom field
  // (e.g. Meta Lead Ads form questions) read-only, so they're visible on the record.
  const definedKeys = new Set(customFields.map((f) => f.key));
  const cf = (lead.custom_fields ?? {}) as Record<string, unknown>;
  const prettify = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const answerEntries = Object.entries(cf).filter(([k]) => !definedKeys.has(k) && !k.startsWith("fb_"));
  const sourceEntries = Object.entries(cf).filter(([k]) => k.startsWith("fb_"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/leads" className="hover:underline">Leads</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{name}</span>
      </div>
      <h1 className="text-xl font-bold text-slate-800">{name}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr_18rem]">
        <EditableFields
          table="leads"
          id={lead.id}
          fields={[
            { key: "first_name", label: "First name" },
            { key: "last_name", label: "Last name" },
            { key: "company", label: "Company" },
            { key: "email", label: "Email", type: "email" },
            { key: "phone", label: "Phone", type: "tel" },
            { key: "source", label: "Source" },
            { key: "status", label: "Status", type: "select", options: [...LEAD_STATUSES] },
            { key: "score", label: "Score", type: "number" },
            ...customFields,
          ]}
          initial={lead}
        />

        <RecordTimeline
          recordType="lead"
          recordId={lead.id}
          userId={user!.id}
          initialItems={items}
        />

        <div className="space-y-4">
          <LeadConvert leadId={lead.id} convertedDealId={lead.converted_deal_id} />

          <RelatedCard title="Facts">
            <div className="px-2 py-1 text-sm text-slate-600">
              Source: <span className="font-medium text-slate-800">{lead.source || "—"}</span>
            </div>
            <div className="px-2 py-1 text-sm text-slate-600">
              Score: <span className="font-medium text-slate-800">{lead.score}</span>
            </div>
          </RelatedCard>
        </div>
      </div>

      {(answerEntries.length > 0 || sourceEntries.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Captured form answers</h3>
          {answerEntries.length > 0 ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {answerEntries.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">{prettify(k)}</dt>
                  <dd className="mt-0.5 break-words text-sm text-slate-700">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">No additional answers captured.</p>
          )}
          {sourceEntries.length > 0 && (
            <p className="mt-3 break-words border-t border-slate-100 pt-3 text-xs text-slate-400">
              {sourceEntries.map(([k, v]) => `${k}: ${String(v)}`).join("   ·   ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
