# F10 — Resubmit the rejected Facebook-Login set

## Purpose
Get the four rejected permissions approved. Rejection reason (all four): "Screencast Not Aligned with Use Case Details" —
the video did not show the full login → grant → use flow. The product itself was not faulted.

## Scope (code already exists; this is demos + readiness)
- `pages_manage_ads` — list a Page's lead forms and **Import past leads**.
- `instagram_basic` — connected Instagram account name/handle after Facebook login.
- `instagram_manage_comments` — comment from a second account → CRM comment rule replies publicly.
- `instagram_manage_messages` — two-way: DM in → reply from CRM → arrives on phone → user replies → visible in CRM (reviewer asked for this specifically).

## Deliverables
- One screencast per permission: English UI, captions, full flow (Connect → Meta permission dialog → grant → feature → result).
- Reviewer kit: test tenant + login, test Page + Instagram account with an app role, step list.
- Privacy page already lists these (commit caaddab). Decide and remove or submit `ads_management` (still requested by Connect button).
- Pre-submission Playwright run on the test tenant (script exists: scratchpad `pw/e2e-live.js`).

## Impact map
- `meta.ts` scopes (if `ads_management` removed), privacy page, Meta dashboard use-case text. No feature code changes expected.

## Edge cases and failure modes
- Import past leads can show #200 if the connecting user lacks the permission; demo with the role-holding account.
- 24 h DM window and Standard-access limits: demo accounts must have an app role.

## Acceptance criteria
- Each screencast shows login, the permission prompt, the grant and the feature result without cuts.
- Playwright run on the test tenant passes before recording. Use-case text per permission is written.
