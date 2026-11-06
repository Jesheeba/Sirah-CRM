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

## Open questions
- Should the OAuth scope list gain `ads_read` so `fb_ad_name` resolves reliably? It widens the
  permission the admin is asked to grant and needs App Review. Currently NOT requested.
