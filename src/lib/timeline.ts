import type { TimelineItem } from "@/lib/types";

/** Shared by every record detail page (leads/contacts/accounts/deals) that renders RecordTimeline. */
export const ACTIVITY_SELECT =
  "id, subject, type, occurred_at, direction, outcome, duration_minutes, description";

interface ActivityRow {
  id: string;
  subject: string | null;
  type: string;
  occurred_at: string;
  direction: string | null;
  outcome: string | null;
  duration_minutes: number | null;
  description: string | null;
}

export function activityToTimelineItem(a: ActivityRow): TimelineItem {
  return {
    id: a.id,
    kind: "activity",
    text: a.subject ?? a.type,
    meta: a.type,
    at: a.occurred_at,
    ...(a.type === "call"
      ? { call: { direction: a.direction, outcome: a.outcome, duration_minutes: a.duration_minutes, notes: a.description } }
      : {}),
  };
}
