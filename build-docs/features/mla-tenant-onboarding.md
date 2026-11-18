# F7 — MLA tenant onboarding + roles

## Purpose
Stand up the MLA's tenant correctly the first time, with roles that fit an office.

## Architecture
- Provision with the existing Super Admin flow (`provisionTenant`), then a checklist page: connect Instagram → set reply mode →
  write style/facts sheet → invite staff → set retention.
- Roles (as built): existing Admin = everything, Manager = approver, Sales Rep = drafter. A read-only viewer role needs permission-model work — follow-up.
- Branding labels preset for the tenant ("Issues", "Citizens").
- Seed: default categories/tags for comments (e.g. Complaint, Request, Praise, Query, Other).

## Impact map
- `admin_provision_tenant` (no change; extra seed done by a follow-up RPC), roles/permissions UI, branding labels, Super Admin tenant page.

## Edge cases and failure modes
- Seed run twice → idempotent. Tenant without a connected account → inbox shows guided empty state, nothing breaks.
- Staff leaves → their pending drafts are reassignable.

## Acceptance criteria
- New tenant gets roles and defaults in one action; re-running changes nothing.
- A Drafter cannot approve; an Approver can; a Viewer can read only (server-enforced).
