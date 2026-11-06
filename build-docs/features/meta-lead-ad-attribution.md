# Feature: Meta lead ad attribution (ad name, ad ID, page ID)

Status: implemented 2026-11-06.

## Purpose
A lead arriving from Meta Lead Ads could be traced to its *form* but not to the *ad* that produced
it. The ad id and page id were already captured but shown only as an unlabelled grey metadata line
on the lead detail page, and the ad's human-readable name was never fetched at all. Without the ad
name you cannot tell which creative is generating leads without going back into Ads Manager.

## Architecture
- `src/lib/meta.ts` — `fetchAdName(adId, pageToken)`: `GET /{ad-id}?fields=name` on the Graph API.
  Mirrors the existing `fetchFormName`: trims, returns `null` on blank/missing/error.
- `src/app/api/meta/leadgen/route.ts` (live webhook) — after storing `fb_ad_id`, resolves the ad
  name and stores `fb_ad_name` when Meta returns one.
- `src/app/(app)/settings/integrations/meta-actions.ts` (historical backfill) — resolves names once
  per *distinct* ad id across the whole import, not once per lead, then stamps each row.
- `src/app/(app)/leads/[id]/page.tsx` — Facts card gained labelled **Ad**, **Ad ID** and
  **Page ID** rows.
- `src/components/leads/LeadsClient.tsx` — new **Ad** column (truncated, with ad name / ad id /
  page id in its tooltip) and an **All ads** filter beside the existing ad-form filter. Falls back
  to the ad id as the display and grouping key when the name is absent.
- `src/lib/lead-feed.ts` — `ad_name` added to `FeedLead`, `toFeedLead` and the CSV base columns.
  `ad_id`, `page_id` and `page_name` were already exposed by the feed.

Data model: no migration. Everything lands in the existing `leads.custom_fields` JSONB under the
`fb_` prefix convention.

## Impact map
| Touched | Risk |
|---|---|
| `meta.ts` | New function only; existing callers unaffected. |
| `leadgen` webhook | Adds one Graph call per lead that has an `ad_id`. Slower webhook; the call is wrapped so a failure cannot lose the lead. |
| backfill action | Adds one Graph call per distinct ad. A page with many ads imports slower. |
| `lead-feed.ts` | **Breaking-ish for consumers:** the CSV gains an `ad_name` column, so a consumer indexing columns by position shifts. JSON consumers gain a key, which is additive. |
| `facebook-leads` export route | No change needed; serialises whatever `toFeedLead` returns. |
| leads list | Column count 6 → 7; empty-state `colSpan` and table `min-w` updated to match. |
| lead detail | Additive rows in the Facts card. |

## Edge cases and failure modes
- **Page token lacks ads access** (common): Graph refuses the ad node → `fb_ad_name` absent, ad id
  still stored and displayed. Covered by test.
- **Blank / missing name** in Meta's reply → `null`, not an empty string.
- **Network throw** → `null`; the lead is still inserted.
- **Lead with no `ad_id`** (organic form, or Meta withheld it) → Ad column shows "—", no Graph call.
- **Pre-existing leads** keep no `fb_ad_name`; the idempotency check in `meta_lead_events` means a
  re-import skips them. They display the ad id only.
- **Spreadsheet formula injection** — ad names are advertiser-controlled text landing in CSV;
  already neutralised by the existing `csvCell` escaping.
- **Stale ad filter**: narrowing the ad-form filter can leave an ad selected that no longer matches
  any row, showing an empty table. The user clears it via "All ads". Not auto-reset.

## Acceptance criteria
1. A new webhook lead from an ad stores `fb_ad_id`, `fb_page_id`, and `fb_ad_name` when Graph
   permits. ✅ (code path; not exercised against live Meta)
2. `fetchAdName` returns `null` rather than throwing on refusal, blank name, or network error, and
   the lead is still saved. ✅ 4 unit tests in `src/lib/meta-formname.test.ts`
3. The lead detail Facts card shows Ad, Ad ID and Page ID when present, and omits each row when
   absent. ✅ (conditional render)
4. The leads list shows an Ad column and can filter by ad, falling back to the ad id when the name
   is unknown. ✅
5. The pull feed exposes `ad_name` in JSON and CSV. ✅ `src/lib/lead-feed.test.ts`
6. `tsc --noEmit` clean, full suite green. ✅ 104 tests passing

## Not done
- `ads_read` is not in the OAuth scope list, so `fb_ad_name` resolution stays best-effort.
- No backfill of `fb_ad_name` onto leads already in the database.
- Ad name is not surfaced in the duplicates view.
