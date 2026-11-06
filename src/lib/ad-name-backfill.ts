/**
 * Pure helpers for backfilling `fb_ad_name` onto leads that were stored before ad names
 * were captured. Kept out of the server action so the grouping and merge rules are
 * unit-testable (vitest runs in a node environment with no Next server-action harness).
 */

export interface BackfillLeadRow {
  id: string;
  custom_fields: Record<string, unknown> | null;
}

/** Distinct ad ids among leads that still need a name — one Graph call each, not one per lead. */
export function distinctAdIds(rows: BackfillLeadRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    const adId = r.custom_fields?.fb_ad_id;
    const name = r.custom_fields?.fb_ad_name;
    // Only leads that have an ad but no name yet. Re-running must not re-resolve.
    if (typeof adId === "string" && adId && !(typeof name === "string" && name)) ids.add(adId);
  }
  return [...ids];
}

/**
 * The custom_fields to write for one lead, or null when it should be left alone.
 * Merges rather than replaces: a lead's form answers and other fb_* metadata must survive.
 */
export function mergedCustomFields(
  row: BackfillLeadRow,
  namesByAdId: Map<string, string>,
): Record<string, unknown> | null {
  const cf = row.custom_fields ?? {};
  const adId = cf.fb_ad_id;
  if (typeof adId !== "string" || !adId) return null;
  if (typeof cf.fb_ad_name === "string" && cf.fb_ad_name) return null; // already named
  const name = namesByAdId.get(adId);
  if (!name) return null; // Meta refused or returned nothing — keep the id, write nothing
  return { ...cf, fb_ad_name: name };
}
