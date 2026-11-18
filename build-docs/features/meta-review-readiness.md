# F8 — Meta review readiness

## Purpose
Get `instagram_business_basic`, `instagram_business_manage_comments` and webhook fields `comments`/`mentions` approved
(and the pending Facebook-Login set) — the earlier rejections were "screencast not aligned with use case".

## Architecture / deliverables
- Meta app: add Instagram API with Instagram Login product; set redirect URI, webhook callback + verify token,
  **deauthorize** and **data-deletion** callback URLs (new routes `/api/ig/deauthorize`, `/api/ig/data-deletion`).
- Privacy + terms pages: list the new permissions and webhook data, retention, deletion route.
- Reviewer kit: test tenant + login, a test Instagram professional account with an app role, step-by-step instructions.
- One screencast per permission, English UI with captions, full flow:
  1. basic: Connect with Instagram login → permission screen → account name/handle shown in CRM → recent posts listed.
  2. manage_comments: comment from a second account → appears in inbox → draft → approve → reply visible on Instagram.
  3. `comments` webhook: live comment arrives in CRM without refresh.
  4. `mentions` webhook: @mention from a second account → appears as a mention with the post.
  5. `instagram_business_manage_messages` (reviewer asked for two-way before): DM from a test account → appears in inbox →
     reply from the CRM → arrives on the phone → user replies → shows in the CRM. Both handles visible. Also a keyword
     rule firing a private reply to a comment.
- Demo shows only person-controlled and keyword flows. **No AI in the recording** (Phase B).
- Use-case text per permission (what, why, user benefit, data kept).
- Submission order: Facebook-Login set (`pages_manage_ads` + Instagram trio) can go separately; this set goes together once F1–F4 work live.

## Impact map
- `middleware.ts` public paths, privacy/terms, Meta dashboard settings (manual), Super Admin tenant for the test account.

## Edge cases and failure modes
- Mentions/comments webhooks only deliver real-user data after Advanced Access → demo with role-holding test accounts.
- Reviewer cannot sign in / test account locked → provide fallback login and a pre-recorded fallback video.
- Callback URLs not publicly reachable or slow → monitored in the pre-submission checklist.

## Acceptance criteria
- Pre-submission checklist all green: callbacks return 200/400 correctly, privacy lists every permission, 4 screencasts rehearsed end to end on the live site, Playwright run passes on the test tenant.
