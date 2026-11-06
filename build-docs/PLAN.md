# Plan

## Status
This folder was created on 2026-11-06, partway through an already-built application. It is **not**
a from-scratch plan: the CRM (auth, tenants, leads, deals, sequences, Meta/WhatsApp/Instagram
integrations, billing) already exists. Treat `Sirah_CRM_Master.md` and
`Sirah_CRM_Build_Specs.md` as the originating specs and `BUILD_BLOCKERS.md` as the standing log of
judgment calls.

## Goal and scope
Sirah CRM — a multi-tenant sales CRM for an agency and its clients: capture leads from Meta Lead
Ads, WhatsApp and Instagram, work them through a pipeline, and convert them to deals.

Out of scope for this folder, for now: retro-documenting features built before 2026-11-06. Feature
docs are written as each feature is next touched, not in bulk.

## Project memory
See `MEMORY.md`. The constraints that shaped the current feature: `fb_`-prefixed metadata on
`leads.custom_fields`, best-effort Graph enrichment, service-role-only token access, and no git
remote (so the workflow's commit step cannot run).

## Features
| Feature | Doc | Status |
|---|---|---|
| Meta lead ad attribution (ad name, ad ID, page ID) | `features/meta-lead-ad-attribution.md` | done 2026-11-06 |

## Build order
Dependency-free additions to an existing integration; no sequencing constraints. Next candidates,
not yet approved:
1. Backfill `fb_ad_name` onto leads already stored (needs a decision on re-reading Meta for
   historical leads).
2. Add `ads_read` to the OAuth scopes so ad names resolve reliably (needs Meta App Review).
