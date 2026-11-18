/** Turning a social-desk item into a CRM lead / citizen issue (F5). Pure, unit-tested. */

export const ISSUE_ATTACH_WINDOW_MS = 30 * 24 * 3600_000;

const SOURCE: Record<string, string> = {
  comment: "Instagram Comment",
  mention: "Instagram Mention",
  tag: "Instagram Tag",
  dm: "Instagram Message",
};

export interface IssueSource {
  id: string;
  kind: string;
  author_handle: string | null;
  text: string | null;
  permalink: string | null;
}

/** Lead fields for an item. `ig_*` custom fields keep the origin; the handle is the name when nothing else is known. */
export function issueLeadFields(it: IssueSource) {
  const handle = it.author_handle?.trim() || null;
  const custom: Record<string, string> = { ig_interaction_id: it.id, ig_kind: it.kind };
  if (handle) custom.ig_handle = handle;
  if (it.text?.trim()) custom.ig_text = it.text.trim().slice(0, 2000);
  if (it.permalink) custom.ig_permalink = it.permalink;
  return {
    first_name: handle ? `@${handle}` : "Instagram user",
    source: SOURCE[it.kind] ?? "Instagram",
    custom_fields: custom,
  };
}

/** An earlier open lead for the same person is reused if it is recent enough. */
export function pickExistingLead(
  candidates: { id: string; created_at: string; status: string }[],
  now: Date = new Date(),
): string | null {
  const open = candidates
    .filter((l) => l.status !== "converted" && now.getTime() - Date.parse(l.created_at) <= ISSUE_ATTACH_WINDOW_MS)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return open[0]?.id ?? null;
}
