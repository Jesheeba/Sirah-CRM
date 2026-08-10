import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditableFields from "@/components/record/EditableFields";
import RecordTimeline from "@/components/record/RecordTimeline";
import LeadConvert from "@/components/leads/LeadConvert";
import SequenceEnrollCard from "@/components/leads/SequenceEnrollCard";
import AuditHistory from "@/components/record/AuditHistory";
import { customFieldDefsFor } from "@/lib/customFields";
import { ACTIVITY_SELECT, activityToTimelineItem } from "@/lib/timeline";
import { LEAD_SCORING_ACTIONS } from "@/lib/lead-scoring";
import { LEAD_STATUSES, type SequenceEnrollment, type TimelineItem } from "@/lib/types";

function fmtWhen(at: string) {
  try { return new Date(at).toLocaleString(); } catch { return at; }
}

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

  const [notesRes, actsRes, tasksRes, sequencesRes, enrollmentsRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("related_to_type", "lead")
      .eq("related_to_id", id),
    supabase
      .from("activities")
      .select(ACTIVITY_SELECT)
      .eq("related_to_type", "lead")
      .eq("related_to_id", id),
    supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .eq("related_to_type", "lead")
      .eq("related_to_id", id)
      .is("deleted_at", null),
    supabase.from("sequences").select("id, name").eq("is_active", true).is("deleted_at", null),
    supabase.from("sequence_enrollments").select("*, sequences(name)").eq("lead_id", id).order("enrolled_at", { ascending: false }),
  ]);

  const { data: scoreEventsData } = await supabase
    .from("lead_score_events")
    .select("id, action, points, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(10);
  const scoreEvents = (scoreEventsData ?? []) as { id: string; action: string; points: number; created_at: string }[];
  const actionLabel = (a: string) => LEAD_SCORING_ACTIONS.find((m) => m.action === a)?.label ?? a;

  const items: TimelineItem[] = [
    ...((notesRes.data ?? []) as any[]).map((n) => ({
      id: n.id, kind: "note" as const, text: n.body, at: n.created_at,
    })),
    ...((actsRes.data ?? []) as any[]).map(activityToTimelineItem),
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

          <SequenceEnrollCard
            leadId={lead.id}
            availableSequences={(sequencesRes.data ?? []) as { id: string; name: string }[]}
            enrollments={(enrollmentsRes.data ?? []) as SequenceEnrollment[]}
          />

          <RelatedCard title="Facts">
            <div className="px-2 py-1 text-sm text-slate-600">
              Source: <span className="font-medium text-slate-800">{lead.source || "—"}</span>
            </div>
            <div className="px-2 py-1 text-sm text-slate-600">
              Score: <span className="font-medium text-slate-800">{lead.score}</span>
            </div>
          </RelatedCard>

          {scoreEvents.length > 0 && (
            <RelatedCard title="Score history">
              {scoreEvents.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 px-2 py-1 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-slate-700">{actionLabel(e.action)}</p>
                    <p className="text-xs text-slate-400">{fmtWhen(e.created_at)}</p>
                  </div>
                  <span className={`shrink-0 font-semibold ${e.points >= 0 ? "text-green-600" : "text-rose-600"}`}>
                    {e.points >= 0 ? `+${e.points}` : e.points}
                  </span>
                </div>
              ))}
            </RelatedCard>
          )}

          <AuditHistory entityType="leads" entityId={lead.id} />
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
