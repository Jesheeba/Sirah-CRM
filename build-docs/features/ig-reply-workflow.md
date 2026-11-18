# F4 — Reply workflow: draft → approval → post (and AI mode)

> **Phase split.** Phase A (submitted to Meta): person drafts + approval + audit, replies to comments (public) and DMs, driven by F9 rules.
> Phase B (after submission, no new Meta permission): the AI draft and `ai_auto` modes below. Do not ship AI before the review is submitted.

## Purpose
Answer comments/mentions on a public figure's account safely, with the level of control the tenant chooses.

## Architecture
- Per-tenant setting `ig_reply_mode`:
  1. `human_approval` (default): staff or AI **drafts**, an Approver signs off, then it posts.
  2. `ai_auto`: AI replies without a human, **only inside guardrails** (below).
  3. `direct`: authorised staff post immediately; audit-logged.
- Table `ig_replies`: interaction_id, tenant_id, body, source (human/ai), status
  (draft → pending_approval → approved → sent | rejected | failed), drafted_by, approved_by, sent_at, provider_reply_id, error.
- Post: `POST /{comment-id}/replies` with the account token (`instagram_business_manage_comments`).
- AI drafts reuse `lib/ai.ts` `draftReply` with a tenant-written **style + facts sheet** (approved positions only).
- **AI auto guardrails:** allow-listed categories only (thanks, greetings, event info, "how to reach office");
  anything about allegations, policy stance, caste/religion, elections, legal, minors, abuse → **always human**;
  confidence/uncertainty → human; per-hour and per-day caps; one-click **kill switch**; never reply to own account
  or to the same author twice in a thread; every AI reply stored with prompt version.
- Approver role/permission `ig.approve`; approver cannot be the drafter in `human_approval` (configurable).
- Audit: every state change row-logged with actor and time.

## Impact map
- `lib/ai.ts` (new prompt entry), permissions, notifications (pending approvals), `ig_interactions.status`, settings page (mode, style sheet, caps).
- Existing IG automation rules unchanged.

## Edge cases and failure modes
- Comment deleted before send → `failed` with reason. Token expired → blocked, tenant notified, draft kept.
- Duplicate post on retry → idempotent via stored provider_reply_id. Graph 429/5xx → retry then `failed`.
- AI unavailable → falls back to human queue (never blocks ingestion). Reply >2200 chars/emoji limits → validated before approve.
- Approver and drafter same person where forbidden → rejected. Mode changed while replies pending → pending items unaffected.
- Prompt injection via comment text ("ignore your rules…") → comment text passed as data, guardrails enforced in code, not in prompt.

## Acceptance criteria
- Under `human_approval`, nothing reaches Instagram until approved (test asserts no Graph call).
- Rejected draft is never sent. Approved draft posts exactly once even if approve is clicked twice.
- Sensitive-category comment under `ai_auto` is routed to human (table-driven test with 20 sample comments).
- Kill switch stops AI sends immediately. Every sent reply has actor + audit rows.
