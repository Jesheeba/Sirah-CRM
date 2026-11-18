# PLAN — MLA Social Desk (Instagram Login)

Status: **DRAFT v2, awaiting approval.** No code written.

## Goal and scope
- Let an **MLA tenant** (Instagram-only account, no Facebook Page) connect Instagram and work its
  **comments, @mentions, DMs and posts that tag the account** inside Sirah CRM.
- Flow: ingest → inbox → reply (person, keyword rule, later AI) → optionally turn into a citizen issue → reports.
- Permissions covered (all from the user's checklist + messages):
  `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`,
  webhook fields `comments`, `mentions`, `messages`. Business Verification already done.
- **Out of scope:** paid-ads/election-ad compliance, posting new media, ML sentiment, replacing the existing
  Facebook-Login Instagram automation (stays for Page-linked clients).

## Strategy: two phases, to avoid another rejection
Meta approves a permission only when the reviewer **sees it used end to end**. Earlier rejections were exactly that.
- **Phase A — everything a permission is needed for, nothing more.** Connect, ingest, inbox, person reply with
  approval, keyword rules (public reply + private reply/DM), DM reply. Each permission has a visible, working demo.
- **Submit to Meta after Phase A is live and rehearsed.**
- **Phase B — while Meta reviews: AI drafts and AI auto-reply.** Needs **no new permission** (it uses the same
  comment/DM sending), so it can't be rejected and doesn't block the review. Ship after approval, in stages.
- Reviewers can reject for unclear or risky automated behaviour, so the submission demo shows deterministic,
  human-controlled flows only. AI is introduced afterwards.

## Project memory respected / changed
- Existing IG automation (0056/0057, `instagram-webhook-handler.ts`, `instagram-comment-automation.ts`) is keyed on
  `meta_lead_pages.page_id` → **new** `ig_accounts` table; existing flow untouched. Keyword-rule logic is reused as a pattern.
- Reuse: `lib/ai.ts` (Phase B), branding labels, roles/permissions, `workflows/tick`, service-role-only token storage (0023).
- Change: Meta app gets the **Instagram API with Instagram Login** product and a second webhook object.

## Decisions (user)
1. 2026-11-18: MLA account is Instagram only → Instagram Login.
2. 2026-11-18: wants inbox, reply workflow, issues, reports; reply mode is a per-tenant choice.
3. 2026-11-18: MLA is a tenant on the existing platform.
4. 2026-11-18: add `instagram_business_manage_messages`; build keyword matching first, AI after approval.

## Features and build order
| # | Feature | Phase | Doc |
|---|---|---|---|
| F1 | Instagram Login connect + token lifecycle | A | features/ig-login-connect.md |
| F2 | Ingestion: comments, mentions, tags, DMs | A | features/ig-ingest.md |
| F3 | Inbox (comments, mentions, DMs) | A | features/ig-inbox.md |
| F4 | Person reply + approval + audit | A | features/ig-reply-workflow.md |
| F9 | Keyword rules (public reply, private reply, DM) | A | features/ig-keyword-rules.md |
| F5 | Interaction → lead / citizen issue | A | features/ig-to-issue.md |
| F7 | MLA tenant onboarding + roles | A | features/mla-tenant-onboarding.md |
| F8 | Meta review readiness (privacy, callbacks, demos) → **SUBMIT** | A | features/meta-review-readiness.md |
| F10 | **Resubmit the rejected Facebook-Login set** (`pages_manage_ads`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`) — separate submission, can go first | A0 | features/meta-resubmit-facebook-set.md |
| F6 | Reports | B | features/ig-reports.md |
| F4b | AI drafts, then AI auto-reply with guardrails | B | features/ig-reply-workflow.md (AI section) |

Order: F1 → F2 → F3 → F4 → F9 → F5 → F7, with F8 prepared alongside; submit; then F6 and F4b.
Per feature: tests mapped to acceptance criteria → run → regression on the impact map → commit+push.

## Risks (said plainly)
- Mentions/comments/messages webhooks deliver real-user data only after Advanced Access; demos use role-holding test accounts.
- DM rules: reply within **24 h** of the user's last message; a **private reply** to a comment is allowed once, within **7 days**.
- IG Login tokens last 60 days → refresh job required.
- Personal data of commenters (India DPDP Act) → retention setting and deletion callback.
- Keyword matching is a plain "contains" check; broad words cause wrong replies → rules need priorities, a blocklist and a test box.
- AI on a public figure's account can publish wrong statements → Phase B, human approval by default, narrow auto allow-list.
- Effort: several days for Phase A + one review round. Not deliverable same day.

## Open questions
- Retention period for stored comments/DMs (suggest 12 months)?
- AI draft languages (Phase B): English / Tamil / Hindi?
