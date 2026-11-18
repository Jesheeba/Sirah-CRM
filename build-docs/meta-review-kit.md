# Meta App Review kit — Sirah CRM Leads (app 1671800907458020)

**One submission** (since 2026-11-18): the MLA desk moved to Meta's *Instagram API with Unified Login*, which uses
the same `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages` permissions as the Page-linked
clients — so one approval covers both. Plus `pages_manage_ads` for past-lead import.

Last rejection reason (all four): *"Screencast not aligned with use case details"* — every video below shows the full
flow: **login → Meta permission screen → grant → feature → visible result**. English UI, captions on every step,
no cuts inside a flow, no AI shown.

## Meta dashboard values

| Setting | Value |
|---|---|
| Privacy policy URL | https://sirah-crm-tfvi.vercel.app/privacy |
| Terms URL | https://sirah-crm-tfvi.vercel.app/terms |
| Data deletion URL (Facebook Login) | https://sirah-crm-tfvi.vercel.app/api/meta/data-deletion |
| Unified login → configuration | Create one: Instagram account (required), permissions `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages` only (untick ads and content publish), token expiration **Never** |
| Unified login → redirect URL (register + select) | https://sirah-crm-tfvi.vercel.app/api/ig/oauth/callback |
| Unified login → webhooks | Callback https://sirah-crm-tfvi.vercel.app/api/ig/webhook, verify token = `IG_VERIFY_TOKEN`; subscribe **comments, mentions, messages** |
| Vercel env | `META_APP_ID`, `META_APP_SECRET` (exist), **`IG_CONFIG_ID`** = the configuration id, `IG_VERIFY_TOKEN` — redeploy after |

## Reviewer access
- CRM login: a dedicated reviewer user in a test tenant (create in Super Admin; give the password only in the
  submission's "test instructions" field — never in chat or docs).
- A test Facebook Page + its Instagram account (Facebook-Login flows), and a test Instagram professional account
  (Unified Login / MLA desk), each with an app role (Instagram tester) so webhooks deliver before approval.
- A second, ordinary Instagram account to comment, @mention and DM from (its account must be public for mentions).

---

### pages_manage_ads
**Use case:** "Businesses connect their Facebook Page so leads from their own Lead Ads forms arrive in their CRM.
`pages_manage_ads` lets us list the Page's lead forms so the business can import past leads submitted before they
connected. We only read the forms and leads of Pages the user connects."
**Screencast:** Settings → Integrations → *Connect Facebook* → Facebook login → permission screen (pause) → choose the
Page → Save → Page shows *Subscribed* → *Import past leads* → Leads list shows the imported leads with form and date.

### instagram_basic
**Use case:** "A business connects its Instagram professional account — with or without a Facebook Page — and the CRM
shows which account is connected (name, username) and the posts that tag it."
**Screencast:** Settings → Integrations → Instagram card → *Connect Instagram* → log in **with Instagram** → permission
screen (pause) → select the account → *Allow* → card shows *@username · Active*. Open **Social** → *Refresh tagged
posts* → a post that tags the account appears.

### instagram_manage_comments (+ webhook fields `comments`, `mentions`)
**Use case:** "Staff read every comment on the account's posts and every @mention of the account anywhere on Instagram
in one inbox, and reply from the CRM. Replies are approved by a manager before posting (or posted directly by a
manager, if the organization chooses). Keyword rules written by the business can answer common questions."
**Screencast:** 1) Phone: second account comments on the business's post → appears in Social without refreshing.
2) Open it → public reply → *Send for approval* → manager logs in → *Approve & send* → phone: reply visible under the
comment. 3) Phone: second account @mentions the business in a comment on **its own** post → appears in Social as
*Mention* → reply → visible on Instagram. 4) Show *Automatic replies*: rule "office" → comment "where is the office"
→ reply posted.

### instagram_manage_messages (reviewer asked for **two-way**)
**Use case:** "Customers / citizens message the business; staff reply from the CRM within Instagram's 24-hour window,
and can send one private reply to a commenter."
**Screencast:** 1) Phone sends a DM → appears in Social (*Message*). 2) Reply from the CRM → arrives on the phone.
3) Phone answers → appears in the CRM conversation. 4) On a comment, send a *Private reply* → DM arrives on the phone.
Both usernames visible throughout.

---

## Pre-submission checklist
- [ ] Unified login configuration created; `IG_CONFIG_ID` in Vercel; redeployed.
- [ ] Redirect URL registered and selected on the configuration; webhooks saved with comments, mentions, messages.
- [ ] Test accounts have app roles and accepted invites; the mentioning account is public.
- [ ] Real end-to-end run on the live site: connect → comment, mention, DM arrive → replies post.
- [ ] Playwright live runs pass on a throwaway tenant (scratchpad `pw/e2e-social.js`, `pw/e2e-live.js`).
- [ ] Privacy page lists every requested permission (enforced by `meta-scopes.test.ts`).
- [ ] Use-case text pasted per permission; reviewer test instructions include the CRM login.
- [ ] No AI shown in any recording.
