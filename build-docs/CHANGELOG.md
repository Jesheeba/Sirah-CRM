# Changelog

## 2026-11-06 — feat(meta-lead-ad-attribution)
Show the ad behind every Meta lead.

- `src/lib/meta.ts`: added `fetchAdName(adId, pageToken)` (best-effort, null on failure).
- `src/app/api/meta/leadgen/route.ts`: webhook now stores `fb_ad_name` next to `fb_ad_id`.
- `src/app/(app)/settings/integrations/meta-actions.ts`: backfill resolves ad names once per
  distinct ad id, then stamps `fb_ad_name`.
- `src/app/(app)/leads/[id]/page.tsx`: Facts card shows labelled Ad / Ad ID / Page ID rows.
- `src/components/leads/LeadsClient.tsx`: new Ad column (tooltip carries ad name + ad id + page id)
  and an "All ads" filter; table `min-w` 640→760px, empty-state `colSpan` 6→7.
- `src/lib/lead-feed.ts`: `ad_name` added to `FeedLead`, `toFeedLead`, and CSV base columns.
- Tests: 4 new `fetchAdName` cases; `lead-feed.test.ts` updated for the new column.

No migration.

## 2026-11-06 — feat(backfill-ad-names)
Fill in `fb_ad_name` on leads stored before ad names were captured.

- `src/lib/ad-name-backfill.ts`: pure `distinctAdIds` + `mergedCustomFields` (merge-only, never
  overwrites a name, never drops another field). 9 unit tests.
- `src/app/(app)/settings/integrations/meta-actions.ts`: `backfillAdNames(pageId)` server action —
  admin+tenant guarded, scoped to one Page's leads, one Graph call per distinct ad.
- `src/components/settings/MetaLeadsCard.tsx`: "Fill in ad names" button per connected Page, with a
  result line that distinguishes resolved / partial / no-ads-access / nothing-to-do.

Doubles as the diagnostic for the open `ads_read` question: "resolved 0, refused N" means the Page
token has no ads access.
