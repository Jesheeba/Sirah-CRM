# Meta App Review kit — Sirah CRM Leads (app 1671800907458020)

Two separate submissions. Last rejection reason (all four): *"Screencast not aligned with use case details"* —
every video below shows the full flow: **login → Meta permission screen → grant → feature → visible result**.
English UI, captions on every step, no cuts in the middle of a flow, no AI shown.

## Meta dashboard values

| Setting | Value |
|---|---|
| Privacy policy URL | https://sirah-crm-tfvi.vercel.app/privacy |
| Terms URL | https://sirah-crm-tfvi.vercel.app/terms |
| Facebook Login data deletion URL | https://sirah-crm-tfvi.vercel.app/api/meta/data-deletion |
| Instagram Login — redirect URL | https://sirah-crm-tfvi.vercel.app/api/ig/oauth/callback |
| Instagram Login — webhook callback | https://sirah-crm-tfvi.vercel.app/api/ig/webhook (fields: comments, mentions, messages) |
| Instagram Login — deauthorize callback | https://sirah-crm-tfvi.vercel.app/api/ig/deauthorize |
| Instagram Login — data deletion URL | https://sirah-crm-tfvi.vercel.app/api/ig/data-deletion |
| Vercel env | `IG_APP_ID`, `IG_APP_SECRET` (Instagram app id/secret), `IG_VERIFY_TOKEN` — then redeploy |

## Reviewer access (both submissions)
- CRM login: a dedicated reviewer user in a test tenant (create in Super Admin; give the password in the
  submission's "test instructions" field only — never in chat or docs).
- Test Facebook Page + its Instagram account (Submission 1) and a test Instagram professional account
  (Submission 2), each with an app role (Instagram tester / developer) so webhooks deliver before approval.
- A second, ordinary Instagram account to comment, @mention and DM from.

---

## Submission 1 — Facebook Login set (code ready)

### pages_manage_ads
**Use case:** "Businesses connect their Facebook Page so leads from their own Lead Ads forms arrive in their CRM.
`pages_manage_ads` lets us list the Page's lead forms so the business can import past leads that were submitted
before they connected. We only read the forms and leads of Pages the user connects."
**Screencast:** 1) Log in to the CRM → Settings → Integrations. 2) Click *Connect Facebook* → Facebook login →
permission screen (pause on it) → choose the Page → Save. 3) Back in the CRM the Page shows *Subscribed*.
4) Click *Import past leads* → result message. 5) Open Leads → the imported leads with form name and date.

### instagram_basic
**Use case:** "After connecting with Facebook, we show which Instagram professional account is linked to the
Page (name and username) so the business knows which account the inbox is for."
**Screencast:** Settings → Integrations → *Connect Instagram* (Facebook login) → permission screen → grant →
the Instagram card shows the linked @username.

### instagram_manage_comments
**Use case:** "Businesses answer comments on their own posts from the CRM using reply rules they write."
**Screencast:** 1) Show a comment rule (keyword + reply). 2) On a phone, a second account comments the keyword on
the business's post. 3) The CRM's reply appears under that comment on Instagram (show both screens).

### instagram_manage_messages — reviewer asked for **two-way** messaging
**Use case:** "Businesses read and reply to Instagram direct messages from customers inside the CRM."
**Screencast:** 1) Second account sends a DM from the phone. 2) It appears in the CRM conversation.
3) Reply from the CRM. 4) Reply arrives on the phone. 5) Customer answers. 6) Answer shows in the CRM.
Keep **both usernames visible** the whole time.

---

## Submission 2 — Instagram Login set (MLA social desk)

Prerequisites: Vercel env set + redeploy; Instagram product configured (table above); test account is an
Instagram tester; tenant set up via Super Admin → *Instagram social desk* → *Set up social desk*.

### instagram_business_basic
**Use case:** "An organization without a Facebook Page (e.g. an elected representative's office) connects its
Instagram professional account with Instagram login. We show the account's username, receive its comments,
mentions and messages, and list posts that tag the account so the office can see them."
**Screencast:** Settings → Integrations → *Connect Instagram* (Instagram login card) → Instagram login →
permission screen (pause) → *Allow* → card shows *@username · Active*. Open **Social** → account shown;
click *Refresh tagged posts* → a post that tags the account appears.

### instagram_business_manage_comments (+ webhook fields `comments`, `mentions`)
**Use case:** "Staff read every comment and @mention in one inbox and reply from the CRM. Replies are approved by
a manager before they are posted (or posted directly by a manager, if the organization chooses)."
**Screencast:** 1) Phone: second account comments on the office's post. 2) CRM Social inbox: the comment appears
**without refreshing the page** (`comments` webhook). 3) Open it → write a public reply → *Send for approval*.
4) Log in as the manager → *Approve & send*. 5) Phone: the reply is visible under the comment.
6) Phone: second account @mentions the office in a comment on its own post → appears in Social as *Mention*
(`mentions` webhook) → reply → visible on Instagram.

### instagram_business_manage_messages (+ webhook field `messages`)
**Use case:** "Citizens message the office; staff reply from the CRM within Instagram's 24-hour window, and can
send one private reply to a commenter. Common questions are answered by keyword rules the office writes."
**Screencast (two-way):** 1) Phone sends a DM → appears in Social (*Message*). 2) Reply from the CRM →
arrives on the phone. 3) Phone answers → appears in the CRM conversation. 4) Show *Automatic replies*: a
keyword rule ("office" → address) → phone comments "where is the office" → private reply DM arrives on the phone.
Both usernames visible throughout.

---

## Pre-submission checklist
- [ ] Vercel env set and redeployed; Meta dashboard values above saved (webhook *Verify and save* succeeded).
- [ ] Test accounts have app roles and accepted the invites.
- [ ] Playwright live run on the test tenant passes (scratchpad `pw/e2e-social.js`, `pw/e2e-live.js`).
- [ ] Each flow rehearsed once end to end on the live site before recording.
- [ ] Privacy page lists every requested permission (enforced by `meta-scopes.test.ts`).
- [ ] Use-case text pasted per permission; reviewer test instructions include the CRM login.
- [ ] No AI shown in any recording.
