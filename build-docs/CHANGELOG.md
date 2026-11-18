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

## 2026-11-06 — fix(meta-scopes): request ads_management so ad names resolve
Running "Fill in ad names" on the live site reported 29 ads, 0 resolved — the Page token could
not read any ad node. Root cause: `pages_manage_ads` covers ads on a Page, not the ad object.

- `src/lib/meta.ts`: added `ads_management` to `META_SCOPES_FACEBOOK`, with the reasoning inline.
- `src/app/privacy/page.tsx`: listed the new permission (Meta reviews this page).
- `src/components/settings/MetaLeadsCard.tsx`: a backfill that resolves nothing no longer renders
  in success green — any refusal shows amber.

Existing Pages must be disconnected and reconnected to pick up the new scope.

## 2026-11-06 — feat(lead-detail): every Meta field as a labelled row
The lead detail page dumped the raw `fb_*` metadata as one grey debug line at the bottom while
the Facts card showed only some of it. Now every field has a labelled row and the debug line is
gone — one place, readable.

- Added to the Facts card: Ad form ID, Platform (rendered "Facebook"/"Instagram", not "fb"/"ig"),
  Meta lead ID. Ad, Ad ID, Page ID, Ad form and Form submitted were already there.
- Removed the raw `fb_*` line and the now-dead `sourceEntries`.
- "Captured form answers" now appears only when there are real answers, instead of rendering an
  empty panel saying "No additional answers captured." for a Meta lead with none.

## 2026-11-18 — feat(ig-login-connect): connect an Instagram account without a Facebook Page (MLA desk F1)
First feature of the MLA Social Desk (`PLAN-mla-social-desk.md`). A tenant admin can sign in with
Instagram and connect a Business/Creator account; the CRM stores a 60-day token and keeps it fresh.

- New: `ig_accounts` table (migration 0064; token is service-role only), `lib/ig-login.ts`,
  `/api/ig/oauth/start` + `/callback`, `lib/ig-token-refresh.ts` (daily, in the workflows tick),
  `InstagramLoginCard` on Settings → Integrations, disconnect action.
- Scopes: `instagram_business_basic`, `_manage_comments`, `_manage_messages`; webhook fields
  `comments,mentions,messages` subscribed on connect.
- Needs server env `IG_APP_ID` / `IG_APP_SECRET` (the Instagram app id/secret from the Meta app's
  Instagram product — not the Facebook app id) and migration 0064 applied. Until set, the card
  shows "not set up yet" and nothing else changes.
- Also fixed in the same push set: `(app)/layout.tsx` min-w-0 and the Leads toolbar wrap (phone overflow).

## 2026-11-18 — feat(ig-ingest): receive Instagram comments, mentions, DMs and tags (MLA desk F2)
- New: `ig_interactions` (migration 0065), `POST/GET /api/ig/webhook` (HMAC on the raw body, always 200),
  `lib/ig-webhook.ts` (pure parser: comments, mentions, DMs in both Meta shapes, echoes dropped),
  `lib/ig-ingest.ts` (idempotent store, mention text lookup, own-account comments stored as `ignored`,
  tag polling), `lib/ig-graph.ts`. The daily workflows tick now also polls tags.
- Tags have no webhook and the cron runs once a day, so tags arrive daily or via the inbox refresh (F3).
- Needs `IG_APP_SECRET` (signature) and optionally `IG_VERIFY_TOKEN` (falls back to the Meta verify token);
  set the callback URL `https://<app>/api/ig/webhook` in the Meta app's Instagram product, fields
  `comments`, `mentions`, `messages`. Needs migration 0065 applied.

## 2026-11-18 — fix(meta-scopes): stop requesting ads_management
- Removed `ads_management` from `META_SCOPES_FACEBOOK`, the privacy page, the "ads not granted" banner and its
  `fetchGrantedScopes` check (now unused). Ad names: `META_ADS_TOKEN` (System User) or the ad id.
- New `meta-scopes.test.ts`: every requested scope is approved or in the submission and explained on the privacy page.

## 2026-11-18 — feat(ig-inbox): Social inbox for comments, mentions, tags and DMs (MLA desk F3)
- New `/social` (server-paged 50/page, URL state: type, status, mine, search) and `/social/[id]` (DM history or
  comment thread, permalink, reply slot for F4). Admins/Managers assign, ignore/restore and "Refresh tagged posts";
  Reps read. All writes are tenant-checked server actions; assignee must be in the same organization.
- New opt-in module `social` in branding: hidden unless a tenant turns it on (Settings → Branding → modules), so
  other tenants don't get an empty menu. Branding settings now load/save opt-in modules correctly.
- `lib/social-list.ts`: URL parsing (sanitised search) and status rules (assign/unassign, ignore/restore).

## 2026-11-18 — feat(ig-reply-workflow): reply with approval, from the social desk (MLA desk F4, Phase A)
- Detail page reply panel: public reply (comment / comment mention), private reply (DM to a commenter), DM reply.
  Shows Instagram's window up front (DM 24 h; private reply once, 7 days) and refuses on the server too.
- Approval: default "need approval" — Admin/Manager approves, the writer can't approve their own unless the org
  allows it; approve is claimed atomically so a double click posts once; reject never sends; failed → retry.
  "Direct" mode lets Admins/Managers post at once (Reps still need approval). Setting is admin-only, on /social.
- Inbox shows how many replies wait for approval and marks those rows. Audit trail per reply (`ig_reply_events`).
- New: migration 0066 (`ig_desk_settings`, `ig_replies`, `ig_reply_events`), `lib/ig-reply.ts` (pure rules),
  `lib/ig-send.ts` (Graph writes), `social/reply-actions.ts`, `components/social/ReplyPanel.tsx`.
- Test helper `fake-admin.ts`: `.select()` after a write now returns the affected rows (as Postgrest does).
- No AI in this phase (Phase B, after the Meta submission).

## 2026-11-18 — feat(ig-keyword-rules): automatic replies by keyword (MLA desk F9)
- `/social/rules` (admins): rules for comments, mentions or DMs — keywords (any/all, whole words, any language)
  or catch-all; public reply, private reply, both, or DM reply; "post automatically" or "wait for approval";
  priority; optional one-post or one-account scope; enable/disable; delete.
- Safety (per organization): blocklist words always go to a person; kill switch; hourly/daily caps and a
  10-minute per-person cooldown — over a limit the rule's reply waits for approval instead of posting.
- "Test a comment" box runs the live matcher on sample text and sends nothing.
- Runner fires once per new item from the webhook (never on retries), through the same guarded `deliver`
  path as approved replies (windows, audit, failure handling). Send path moved to `lib/ig-reply-deliver.ts`.
- New: migration 0067 (`ig_rules`, safety columns on `ig_desk_settings`), `lib/ig-rules.ts` (pure),
  `lib/ig-rule-runner.ts`, `social/rules/{page,actions}.ts`, `components/social/RulesManager.tsx`.
- F4 live run (Playwright, throwaway tenant): 28/28 — draft → approval → failed-with-reason → retry → reject,
  audit trail, self-approve setting, tagged post not answerable.

## 2026-11-18 — feat(ig-to-issue): turn a comment, mention or DM into a lead / citizen issue (MLA desk F5)
- Detail page button "Add to {Leads label}" (follows the tenant's label, e.g. "Issues"); then "Open in …".
- One lead per item (second click returns it); the same person's open lead from the last 30 days is reused
  instead of a duplicate; owner = the item's assignee, else whoever clicked; source "Instagram Comment /
  Mention / Message"; `ig_*` custom fields keep handle, text, link and the item id. Item status → issue.
- Lead page shows the Instagram origin with a link back to Social; `ig_*` keys stay out of "Captured form answers".
- Meta lead pull feed unaffected (it only exports leads with `fb_leadgen_id`). No migration.
- Test helper `fake-admin.ts`: added `.is()`.

## 2026-11-18 — feat(mla-tenant-onboarding): one-step social desk setup in Super Admin (MLA desk F7)
- Super Admin → tenant page → "Instagram social desk" card: switches the Social module on, optionally renames
  Leads to "Issues", creates reply settings (approval required, no self-approval) and a starter blocklist for
  sensitive topics. Shows the checklist (module, settings, label, Instagram connected). Safe to re-run: merges,
  never overwrites the tenant's own labels, hidden modules, reply mode or blocklist words.
- **Plan change:** no new "Drafter / Approver / Viewer" roles — the app's permission model only knows Admin,
  Manager and Sales Rep. Mapping: Admin = everything, Manager = approver, Sales Rep = drafter. A read-only
  viewer role needs permission-model work and is left as a follow-up.
- Test helper `fake-admin.ts`: added `.neq()`.
