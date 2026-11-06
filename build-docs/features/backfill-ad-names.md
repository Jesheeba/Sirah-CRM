# Feature: Backfill ad names onto existing leads

Status: implemented 2026-11-06.

## Purpose
`fb_ad_name` is only written when a lead arrives, so every lead stored before the ad-attribution
feature shipped shows a raw ad id instead of a name. This backfills names onto those leads without
re-importing the leads themselves.

Secondary purpose, deliberate: the result tells the admin whether their Page token has ads-level
read access at all. "Resolved 0, refused 48" is the answer to the open `ads_read` question in
MEMORY.md, obtained without Graph API Explorer.

## Architecture
Server action `backfillAdNames(pageId)` in `settings/integrations/meta-actions.ts`:

1. Admin + tenant guard (`requireAdminTenant`), same as every action in the file.
2. Load the Page's token, scoped by `tenant_id` AND `page_id` (service role bypasses RLS, so the
   tenant filter is mandatory).
3. Select this tenant's leads that have `fb_ad_id` but no `fb_ad_name`, and whose `fb_page_id`
   matches this page — a tenant may connect several pages with different tokens, and one page's
   token must not be used to resolve another page's ads.
4. Group those leads by ad id. One Graph call per *distinct* ad, not per lead.
5. For each resolved name, update every lead carrying that ad id, merging into the existing
   `custom_fields` JSONB rather than overwriting it.
6. Return `{ ok, updated, adsResolved, adsRefused, error? }`.

UI: a second button on each page row in `MetaLeadsCard.tsx`, beside "Import past leads".

## Impact map
| Touched | Risk |
|---|---|
| `meta-actions.ts` | New action; existing ones untouched. Reuses `fetchAdName`. |
| `MetaLeadsCard.tsx` | One button + one result line per page row. |
| `leads.custom_fields` | **Writes to existing lead rows.** Merge-only: sets `fb_ad_name`, preserves every other key. Never touches a lead that already has a name. |
| leads list / detail / feed | Rows that showed an ad id start showing a name. No schema or shape change. |
| Graph API quota | One call per distinct ad. Bounded by distinct ads, not lead count. |

## Edge cases and failure modes
- **Token lacks ads access**: every call returns null → `adsResolved: 0`, `adsRefused: n`, zero
  writes. Reported plainly rather than looking like success.
- **Partial resolution**: some ads resolve, others don't. Each resolved name is written; refusals
  are counted. No all-or-nothing rollback — a partially named set is strictly better than none.
- **Nothing to do**: no leads missing a name → `updated: 0` with an explicit "nothing to backfill"
  message, not a silent success.
- **Deleted ad**: Graph 404s → counted as refused, lead keeps its id.
- **Soft-deleted leads** (`deleted_at`) are excluded.
- **Concurrent webhook writes**: a lead arriving mid-backfill already has its name from the
  webhook, and the query only selects leads *missing* one, so there is no clobber.
- **Re-running it** is safe and cheap: already-named leads are filtered out by the same query.
- **Large tenants**: leads are paged in batches of 1000 when selecting, and updates are issued per
  distinct ad id, so a tenant with many leads but few ads costs few calls.

## Acceptance criteria
1. Resolves and writes `fb_ad_name` for leads that have `fb_ad_id` and no name. ✅
2. Preserves all other `custom_fields` keys (merge, not overwrite). ✅ test
3. Writes nothing and reports refusals when Meta refuses every ad. ✅ test
4. One Graph call per distinct ad id, not per lead. ✅ test
5. Never touches another page's or another tenant's leads. ✅ query-scoped; admin guard
6. Idempotent — a second run reports nothing to do. ✅ test
