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

## Open questions
- App Review + Business Verification for `ads_management` is still unstarted. It is the only way
  a CLIENT tenant (who cannot be given a System User token on our Business) gets ad names.
  `META_ADS_TOKEN` solves it for Fortune Innovatives' own account only.
