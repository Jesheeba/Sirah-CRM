# Project memory — Sirah CRM

Decisions, constraints and conventions that the code does not state on its own.
Read at session start; update whenever a decision is made.

## Pre-existing context (recorded 2026-11-06, when build-docs was created)
- `build-docs/` did not exist for most of this project's life. Earlier design notes live in
  `Sirah_CRM_Master.md`, `Sirah_CRM_Build_Specs.md`, `Branding.md` and the running decision log
  `BUILD_BLOCKERS.md`. Those remain authoritative for anything predating this folder.
- `BUILD_BLOCKERS.md` is the existing "judgment calls + platform constraints" log. It is NOT
  superseded by this file; new entries of that kind still belong there.
- Git repo lives at `Sirah-CRM/`, not at `Meta_Lead_SIRAH_DIGITAL/`. Branch `main`, with an
  `origin` remote. Run git commands from `Sirah-CRM/` or they report "not a repository".

## Conventions
- Meta Lead Ads metadata is stored on `leads.custom_fields` under an `fb_` prefix
  (`fb_leadgen_id`, `fb_form_id`, `fb_form_name`, `fb_page_id`, `fb_ad_id`, `fb_ad_name`,
  `fb_platform`, `fb_created_time`). The `fb_` prefix is load-bearing: the lead detail page and
  the pull feed both use it to separate routing metadata from the lead's own form answers.
- Graph API enrichment calls (form name, ad name) are best-effort: they return `null` on failure
  and must never block saving a lead. A lead with no name is still a lead.
- Secrets (Page access tokens) are readable only by the service-role client. Column-level grants,
  not RLS, enforce this — see `supabase/migrations/0023_meta_lead_ads.sql`.

## Constraints
- Meta allows one callback URL per webhook object, so `/api/meta/leadgen` also receives
  `messages`/`feed` events and forwards them to the Instagram handler.
- A Page access token often lacks ads-level read access. `fb_ad_name` is therefore frequently
  absent even when `fb_ad_id` is present. Any UI or export that shows the ad must tolerate this.
- Vitest runs in a `node` environment with no React Testing Library, so client components are not
  unit-tested. Logic that needs a test should live in `src/lib/`.

## Decisions
- 2026-11-06: added `ads_management` to `META_SCOPES_FACEBOOK`. Resolved by evidence, not guess:
  "Fill in ad names" on the live site reported **29 ads, 0 resolved**, and Meta's lead-ads guide
  states ad-level fields need `ads_management` (NOT `ads_read`, which is Insights/CAPI only, and
  NOT `pages_manage_ads`, which covers ads *on a Page*, not the ad object). A Page token is
  acceptable, but only when the connecting person can advertise on both the Page and the ad
  account. Pages connected BEFORE this change keep their old token and must be reconnected.
- Any scope added here must also be listed on `/privacy` — Meta reviews that page, and the list
  is maintained by hand.

- 2026-11-06: ad names now resolve via `META_ADS_TOKEN`, an optional Business Settings System
  User token tried BEFORE the Page token in `fetchAdName`. Evidence for the change: adding
  `ads_management` to the OAuth scopes did NOT work — reconnecting with `auth_type=rerequest`
  still came back with the scope denied (`&ads=denied`), and the backfill still reported 29 ads
  refused. Facebook Login withholds `ads_management` until App Review, whatever the app admin's
  roles. A System User token needs no review, so it is the only route to automatic ad names
  before review. Unset, behaviour is unchanged: leads keep their ad id.

- 2026-11-20: Vercel functions pinned to `sin1` (vercel.json `regions`). Supabase is ap-southeast-1; functions ran in iad1, so every DB call crossed the globe (~230 ms × ~15 per page). `getUserContext` and layout branding are memoised per request with React `cache()`.

- 2026-11-20: Import past leads retries `error`/`skipped`/stuck-`received` lead events (upsert on leadgen_id); only `created` or a fresh `received` count as done.

- 2026-11-20 INCIDENT: Facebook connect moved RD Interlock Bricks' page into Sirah's workspace (upsert on page_id), then a Disconnect removed it. Fixed: a page already owned by another tenant is never moved. One Facebook admin manages several clients' Pages — always assume a connect returns pages of other workspaces.

- 2026-11-20: App Review SUBMITTED (submission 1807922953845814): pages_manage_ads, instagram_manage_comments, instagram_manage_messages, instagram_basic + 6 renewals. Captioned screencasts (user-recorded), new usage texts answering the Oct-13 'screencast not aligned' rejection, system-user-token note, reviewer login = Installtech test workspace. Data handling: processors Supabase + Vercel (added). Keep until decision: TNPSC test lead, 'Saree link - Pink' + 'Street light complaint' rules, @sirah_digital connection.

## Open questions
- App Review + Business Verification for `ads_management` is still unstarted. It is the only way
  a CLIENT tenant (who cannot be given a System User token on our Business) gets ad names.
  `META_ADS_TOKEN` solves it for Fortune Innovatives' own account only.

## MLA Social Desk (Instagram Login) — added 2026-11-18
### Decisions
- 2026-11-18: MLA client = new tenant, Instagram-only → **Instagram Login** product, not Facebook Login. Why: no Page linked.
- 2026-11-18: reply mode is a per-tenant setting (human approval default; AI/direct optional). Why: user said it is up to the client.
- 2026-11-18: add `instagram_business_manage_messages`. Build keyword rules + person reply FIRST and submit; AI is Phase B (needs no new permission, so build it during review). Why: reviewers reject permissions they can't see used; AI adds risk and no permission.
- 2026-11-18: build commit-by-commit on `main`; use a git worktree off `origin/main` when the local folder has someone else's uncommitted edits.
- 2026-11-19: Unified-login webhook keeps callback `/api/meta/instagram-webhook` (not `/api/ig/webhook`). Why: Meta allows one URL per webhook object and the `instagram` object already serves Page-linked DM clients; that route now also calls `processIgDeskBody`. Redirect URL `/api/ig/oauth/callback` registered + selected on config 3830667340420169; `mentions` subscribed.
- 2026-11-19: live test — DMs work end to end on Standard access; comment/mention webhooks need Advanced Access (approved review), so they cannot be demonstrated live before approval. riyazlive added as Instagram Tester.
- 2026-11-17: migration 0063 (lead form/ad dropdown functions + indexes) applied to production.
- Leads list is server-paged (50/page, URL state: page, view, form, ad, sort, q).

### Constraints / conventions
- Tokens and secrets: service-role-only tables, RLS on, no policies, grants revoked (0023/0061/0062 pattern).
- Webhooks: verify signature on raw body first; always 200 to Meta; idempotent on provider id.
- Windows: run tests/tsc with PowerShell + `node node_modules\vitest\vitest.mjs` (Git Bash path casing breaks vitest).
- PowerShell `Set-Content -Encoding utf8` adds a BOM — don't use it for SQL or source files.
- Live end-to-end script: scratchpad `pw/e2e-live.js` (creates a throwaway tenant, deletes it after).

### Open questions
- See PLAN-mla-social-desk.md "Open questions".

### Known issues
- `crm-app` local checkout is behind origin and holds another developer's uncommitted edits.
- `ads_management` is requested by the Facebook connect button but is not in the Meta submission (decision pending).
- Import past leads needs `pages_manage_ads` (not approved yet).
- 2026-11-18: **`ads_management` removed** from the Facebook Connect scopes and the privacy page (user: "not needed"). Why: full ad-account control just to read an ad name, and not in the App Review submission. Ad names come only from the optional System User token `META_ADS_TOKEN`; otherwise the ad id is shown. Existing connected Pages keep their old grant until reconnected — harmless.
- 2026-11-18: MLA desk roles use the existing role model (Admin / Manager = approver / Sales Rep = drafter) instead of new role names, because `getUserContext` only understands those three; a viewer-only role is a follow-up.
- 2026-11-18: **MLA desk switched from Instagram Login (legacy) to Instagram API with Unified Login** (user chose option B). Why: the Instagram Login webhook list has no `mentions` field (user requires mention notifications); Unified Login offers comments, mentions and messages, needs no Facebook Page, uses graph.facebook.com and a never-expiring system-user token, and uses the same `instagram_basic` / `instagram_manage_comments` / `instagram_manage_messages` permissions as Page-linked clients → one App Review submission. New env `IG_CONFIG_ID`; `IG_APP_ID` no longer used; `IG_APP_SECRET` kept only as a webhook-signature fallback. Still to confirm live: reply/DM endpoints and which secret signs Unified webhooks (code accepts Meta or Instagram app secret).
