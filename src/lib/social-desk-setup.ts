/**
 * One-step setup of a tenant as an Instagram social desk (MLA desk F7). Pure merge helpers so
 * re-running setup never wipes a tenant's own branding or safety choices.
 */

/** Starter blocklist for a public office: these always go to a person, never to an automatic reply. */
export const DEFAULT_DESK_BLOCKLIST = [
  "complaint", "bribe", "corruption", "scam", "fraud", "caste", "religion", "election", "vote",
  "court", "police", "case", "protest", "threat", "abuse", "suicide", "death", "accident",
];

type Json = Record<string, unknown>;

/** Social switched on; Leads optionally renamed "Issues". Everything else the tenant set is kept. */
export function mergeDeskBranding(existing: { module_labels?: Json | null; module_visibility?: Json | null } | null, renameLeads: boolean) {
  const labels = { ...(existing?.module_labels ?? {}) };
  if (renameLeads) labels.leads = "Issues";
  return {
    module_labels: labels,
    module_visibility: { ...(existing?.module_visibility ?? {}), social: true },
  };
}

/** Adds the starter words to whatever the tenant already blocks (case-insensitive de-duplication). */
export function mergeBlocklist(existing: string[] | null | undefined, extra: string[] = DEFAULT_DESK_BLOCKLIST): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of [...(existing ?? []), ...extra]) {
    const k = w.trim().toLocaleLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(w.trim());
    }
  }
  return out;
}

export interface DeskStatus {
  socialEnabled: boolean;
  leadsLabel: string | null;
  hasSettings: boolean;
  replyMode: string | null;
  instagramAccounts: number;
}
