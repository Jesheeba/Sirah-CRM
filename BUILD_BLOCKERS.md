# Build Blockers & Open Decisions

Running log of things I was unsure about, judgment calls I made without stopping to ask, and
platform constraints discovered mid-build — per instruction: log it here and keep moving instead
of blocking the build on every ambiguity. Review periodically; anything with a ⚠️ is worth a
deliberate decision from a human rather than staying on my default.

Format: **what**, **what I did**, **why it might need revisiting**.

---

## Platform / infrastructure

### 🔴 Fixed: server-to-server endpoints were unreachable (middleware allowlist)
`src/lib/supabase/middleware.ts` redirects any request with no logged-in user to `/login`, gated by
an `isPublic` allowlist. That list never included `/api/workflows/tick` (Vercel Cron),
`/api/meta/data-deletion` + `/data-deletion-status` (Meta's server-to-server callback + its public
status page), or — until this session added it — `/api/payments/razorpay/webhook/*`. Practical
effect: **the daily cron has likely never successfully executed in production** — not the workflow
engine's async actions, not invoice-overdue marking, and (as of this session) not the rotten-deal
scan or notification digest either, regardless of what any status doc claims. Found while wiring
`/api/email/click` and adding it to the same list; fixed all of the above in the same edit. Worth
independently confirming against real deploy logs (Vercel's cron invocation history) rather than
trusting this account of it — I found and fixed this by reading the code, not by observing a
production failure.

### ⚠️ Vercel Cron is daily, not per-minute
`vercel.json` schedules `/api/workflows/tick` at `"0 0 * * *"` (once a day), not every minute as
`Sirah_CRM_Master.md`'s original text for item #10 claims. This is almost certainly a **Vercel
Hobby (free) plan constraint** — Hobby caps cron jobs to a daily minimum interval; Pro allows
per-minute. Practical effect: every feature riding this cron — async workflow actions
(`send_email`/`send_whatsapp`/`webhook`/`assign_owner`), invoice overdue marking, the rotten-deal
scan, and the notification email digest — has **up to 24h latency**, not near-real-time.
**Decision needed:** stay on Hobby and treat everything on this cron as explicitly "daily batch"
(which I did — e.g. framing the email digest as a deliberate daily-digest UX rather than hiding
the delay), or upgrade to Vercel Pro for per-minute workflow execution. I did not upgrade anything
or change the cron schedule myself.

### Folding new daily jobs into the existing tick instead of new cron entries
Rather than add `vercel.json` cron entries for the notification digest and rotten-deal scan (each
of which risks the same Hobby-plan limits, and Hobby also caps the *number* of cron jobs), I added
both as extra steps inside `/api/workflows/tick`'s existing handler. This means all daily batch
jobs share one invocation and one `maxDuration` (55s) — fine at current scale, but if any one step
grows slow (e.g. thousands of pending digest emails), it could start starving the others. Worth
splitting into separate cron-gated routes if you upgrade to Pro.

### No ESLint config in the repo
`npm run lint` drops into an interactive "Strict vs Base" setup prompt — there's no committed
ESLint config, so it's never actually been run in this repo. I did not set one up (out of scope
for a feature-build turn; happy to do it as its own task). All work in this session was verified
with `tsc --noEmit` + `next build` only, not lint.

---

## Payment Collection (Razorpay) — see also Sirah_CRM_Master.md #28

### Cashfree not built
The original spec listed "UPI / Razorpay" and mentioned Cashfree as an alternative in the PRD's
payments section. Only Razorpay is wired. Adding a second gateway would mean generalizing
`lib/payments.ts` into a provider-agnostic interface — not done, since nothing asked for a second
gateway yet and doing it speculatively would be exactly the kind of premature abstraction to avoid.

### Partial payments on a single Payment Link not reconciled
A Razorpay Payment Link is created for the full outstanding balance and is treated as all-or-
nothing (`payment_link.paid` is the only webhook event handled). Razorpay does support
"accept_partial" links; if that's ever turned on, `fn_record_payment_captured` needs to handle
partial amounts and the link needs to be re-usable for the remainder — not built.

### Workflow-engine event emission skipped
The PRD's Phase 2 guidance says new state changes should emit workflow events proactively so the
automation engine can subscribe later. I did **not** emit an `invoice_paid` workflow event, because
`workflows.entity_type` is currently a closed enum (`leads|contacts|accounts|deals` — see
`lib/workflows.ts` `ENTITY_FIELDS`/`ENTITY_LABEL`) and adding `invoices` means extending that enum,
the `WorkflowEditor` UI's field list, and deciding what invoice fields are condition-able — a
meaningfully bigger change than the payment feature itself. Flagging rather than silently
expanding scope.

---

## Multi-channel Notifications — see also Sirah_CRM_Master.md #15

### Decoupled in-app vs email gating (a real behavior change, not just an add)
The original `fn_should_notify()` (0017) gated *notification row creation itself* on the `in_app`
preference — meaning a user who disabled in-app for a type got literally nothing, including no
email, even after I built the email digest. I judged this to be a design flaw once there are two
independent channels (someone might want email-only, in-app off) and fixed it by decoupling: email
eligibility is now checked independently at digest time, not tied to whether a notifications row
was created for the bell. **This is a genuine behavior change from what shipped before**, not just
new code — worth a sanity check that it matches intent.

### WhatsApp as a notification channel not built
`notification_preferences` only models `in_app`/`email`. Adding `whatsapp` needs a schema change
(new boolean column or a channel-enum redesign) plus reusing `resolveWhatsAppConfig` at digest
time. Not started — the original spec (#15) asked for it explicitly, so this is a known gap, not
an oversight.

---

## Rotten Deals Detection — see also Sirah_CRM_Master.md #12

### ⚠️ "Stale" means stage-idle only, not activity-idle
Per the literal spec, a deal is flagged rotten purely from `now() - last_stage_change_at`, reset
only by `move_deal_stage()`. Logging a call, note, or task against a deal does **not** reset the
clock. Many real sales teams actually want "no activity of any kind," which is a broader
definition. I implemented the narrower, literally-spec'd version because it's simpler and matches
the documented data model exactly — but if the intent was "no contact with the customer," this
under-flags deals where reps are working the deal without moving its stage.

---

## Lead Auto-Assignment / Routing — see also Sirah_CRM_Master.md #13

### "Territory" modeled as a condition, not a fourth strategy
The spec's own schema comment lists `strategy` as `'round_robin'|'territory'|'source'|'load'`, but
territory/source aren't really *assignment strategies* — they're *match criteria*. I implemented
`strategy` as `round_robin|load|specific` and let a rule's `conditions` array express territory
(e.g. `custom_fields.city = "Mumbai"`) or source matching, then apply any strategy to the matched
rule. I'm confident this is the more correct design, but it's a real deviation from the literal
schema text — flagging in case "territory" was meant to imply something more specific (e.g. a
dedicated `territories` table with zone→team mapping, which is PRD item #44, not built yet).

### Priority is a number field, not drag-to-reorder
The spec says "rules builder (drag to order)". I built a plain numeric priority input instead —
functionally equivalent (admin types `0`, `1`, `2`...) but less polished. Scope trim for time, not
a technical blocker; drag-to-reorder would reuse the same pattern already built for pipeline stages
(`reorderStages` in `pipeline-actions.ts`) if wanted later.

### No live load test for round-robin fairness
The acceptance criterion "100 leads distribute evenly under round-robin" was verified by reading
the `SELECT ... FOR UPDATE` locking logic (which is correct for serializing concurrent inserts),
not by actually inserting 100 leads and checking the distribution. Worth a real test pass before
relying on this in production, especially under genuinely concurrent webhook traffic (e.g. a burst
of Meta Lead Ads submissions).

---

## Sales Sequences — see also Sirah_CRM_Master.md #18

### ⚠️ Step delays are "next daily batch," not literal hours
This is the same Vercel-Hobby-daily-cron constraint noted above, but it matters more here: a
sequence step configured as "wait 2 hours" will in practice fire on whatever the next daily tick
is — anywhere from a few minutes to ~24 hours late. The engine's logic is correct (it computes and
respects real `next_run_at` timestamps), but the cron that checks for due enrollments only runs
once a day, so sub-day delays are functionally rounded up to "the next business day." This wasn't
in scope to fix (it's the same root cause logged above, and fixing it means either upgrading
Vercel or moving off cron-polling entirely), but it materially changes what "Sales Sequences" means
in practice — a same-day 3-touch cadence isn't achievable today. Worth surfacing to whoever is
configuring sequences, since a "wait 1 hour" step will visually suggest same-day delivery.

### `owner_id` fallback fixed here, not in workflow-runner.ts
See the master doc entry for #18 — `communications.owner_id` is `NOT NULL DEFAULT auth.uid()`,
which is null under the service-role client. Fixed in the new `sequence-runner.ts` (falls back to
the enrolling user). The pre-existing `execSendEmail`/`execSendWhatsApp` in `workflow-runner.ts`
have the identical gap and were **not** touched — same bug class, different file, and I didn't want
to modify already-shipped, presumably-tested workflow-engine code as a side effect of building
sequences. Worth a dedicated small fix later: add an owner_id fallback (e.g. the workflow's
creator, or the triggering record's own owner) to both actions.

### "Meeting booked" exit condition not implemented
The spec's exit conditions were "reply or meeting booked." There's no meeting-booking concept
anywhere in this codebase yet (PRD item #26, Meeting Booking Page, isn't built), so only the reply
exit (plus two extra status-based exits I added — see the master doc entry) exists. Once #26 exists,
this needs revisiting.

---

## Automatic Lead Scoring — see also Sirah_CRM_Master.md #19

### Two of seven scoring actions have no real trigger yet
`quote_viewed` needs a public/customer-facing way to view a quotation (doesn't exist — Customer
Portal is unbuilt) and `meeting_scheduled` needs a meeting-booking feature (also unbuilt, PRD #26).
Both are pre-seeded in the rules engine with sensible defaults so they'll work the moment their
underlying feature exists — no scoring-side work needed later, just call
`fn_apply_lead_score(lead_id, 'quote_viewed')` / `'meeting_scheduled'` from wherever those features
land.

### Score-event history isn't in the UI
`lead_score_events` logs every point change (so `leads.score` is always explainable — "why is this
lead at 45?"), but nothing surfaces that log anywhere in the product yet. Only the running total
shows (lead detail's Facts card, and the new sortable Score column on the Leads list). Worth adding
a small "score history" panel to the lead detail page later — the data already exists, it's a pure
UI addition.

### Referral detection is a text match, not a structured field
`fn_score_lead_referral()` triggers on `leads.source ilike '%referral%'` — works for "Referral",
"referral - John Smith", etc., but silently misses a differently-worded source string (e.g. "Word
of mouth", "Friend recommendation"). This is a heuristic, not a real classification; fine for now
but worth knowing it can under-fire.

---

## Sales Goals & Targets — see also Sirah_CRM_Master.md #20

### No `teams` table — "team_id" reinterpreted as whole-tenant
The spec's schema included a `team_id` column, but this codebase has no team/group concept at all
— RBAC is a flat Admin/Manager/Sales Rep model (confirmed: no `teams` table anywhere in
`supabase/migrations/`). A "team target" is implemented as `user_id = NULL` (applies to the whole
tenant) rather than a real team hierarchy. If sub-team grouping (e.g. "APAC team" vs "EMEA team")
is ever wanted, this needs revisiting alongside Territory Management (PRD #44, also unbuilt) —
they're the same underlying gap.

---

## Reports — Full Build — see also Sirah_CRM_Master.md #21

### "PDF export" is browser print-to-PDF, not a rendered server-side PDF
Confirmed by grepping the codebase: there is no PDF library anywhere (no `@react-pdf`, no
Puppeteer, nothing). Quotations and invoices already "export PDF" via a bare `(print)` layout +
`window.print()`, and the new report PDF view (`(print)/reports/print`) follows the exact same
pattern for consistency. This is a real, working, zero-dependency approach for interactive use, but
it has a hard consequence: **a cron job cannot drive a browser print dialog**, so the scheduled-
report emailer sends a **CSV attachment**, not a PDF, with a link to the print view for anyone who
wants a formatted copy by hand. If literal "email me a PDF" is required later, the real fix is a
server-side renderer (e.g. Puppeteer/Chromium via a suitable Vercel-compatible build, or a hosted
HTML→PDF API) — a genuinely new dependency, not a quick addition.

### Scheduled reports inherit the daily-cron cadence caveat
Same root cause as the earlier entries in this doc (Vercel Hobby = daily cron only). A "daily"
schedule really means "checked once a day," and "weekly"/"monthly" are approximated by elapsed time
since `last_sent_at` (7 real days; a real calendar-month rollover) rather than a specific day-of-
week/day-of-month a user picked — there's no UI to pick "every Monday" or "the 1st of the month,"
only the cadence tier itself. Fine for the common case, worth knowing before promising precise
delivery timing.

### Custom report builder not attempted
The spec's "pick entity → fields → group-by → filters → sort → chart/table" is a meaningfully
different UI paradigm than the existing fixed-column report + filters model — it needs dynamic
column/field selection, aggregation logic, and a chart-vs-table toggle. Given the existing 5 reports
already cover real self-service filtering, I judged PDF export + scheduling (both clearly spec'd,
both fully missing) as the higher-value use of this session's time over a from-scratch builder.
Flagging so it isn't mistaken for "done" — #21 is 🟡, not ✅, specifically because of this gap.

---

## Unified Conversation Inbox — see also Sirah_CRM_Master.md #23

### Contact-only, not lead/account
`ConversationThread.tsx` takes `contactEmail`/`contactPhone` props and hardcodes
`related_to_type: "contact"` in both the fetch query and the send calls — it only works on the
contact detail page. Leads and accounts can also have email/WhatsApp communications logged against
them (`communications.related_to_type` supports `lead`/`account` too), but neither of those detail
pages got the merged thread — they still show the old notes/activities/tasks-only `RecordTimeline`.
Genericizing this component (accept `relatedType`/`relatedId`/email/phone as generic props) would be
a small, mechanical follow-up if leads/accounts need the same treatment.

### No "assignment state" for conversations
The spec asked for "unread/assignment state." Unread is real (see the master doc entry). Assignment
was not implemented — there's no concept of "this conversation thread is assigned to rep X for
follow-up" independent of the record's own `owner_id`. For a contact, the record owner already
implicitly "owns" the conversation, which covers the common case; a per-thread assignment separate
from record ownership (e.g. a support-style "assign this WhatsApp thread to Priya") was judged out
of scope.

---

## Bulk Email Campaigns — see also Sirah_CRM_Master.md #25

### No campaign-level "reply" metric
The original spec's acceptance criteria mention tracking reply alongside open/click/unsubscribe.
A reply to a campaign email lands as a normal inbound `communications` row against the
lead/contact (same as any other inbound email) — it's visible on that record, but there's no
`email_campaigns.reply_count` or a query that attributes an inbound message back to which
campaign prompted it. Would need a `campaign_id` reference on inbound communications (or a
time-window heuristic) to build properly — not done.

### Suppression is global per tenant, not per-campaign opt-out
Unsubscribing suppresses an email address from *all* future campaigns for that tenant, not just
the one they clicked unsubscribe on. This matches how most senders actually behave (and is the
safer default for deliverability/compliance) but is worth knowing if per-campaign opt-in
granularity is ever wanted.

---

## Duplicate Detection — see also Sirah_CRM_Master.md #42

### Exact match only — no fuzzy/typo-tolerant matching
`fn_find_duplicate_leads`/`fn_scan_duplicate_lead_groups` match on exact normalized email or
exact digits-only phone. "John Smith" vs "Jon Smith", or a typo'd email, won't be caught. Real
fuzzy matching (trigram similarity via `pg_trgm`, or a Levenshtein-distance threshold on name)
would need a new Postgres extension and a deliberate similarity-threshold decision (how close is
"close enough" — too loose creates false-positive merge suggestions, too tight misses real dupes).
Kept to exact matching for this pass since it's unambiguous and needs no tuning; flagged as the
natural next step if reps report missed duplicates in practice.

---

## Carried over from the original build audit (not yet touched this session)

- No duplicate-detection on manual lead creation (only exists in the CSV import wizard).
- No account parent/branch hierarchy (`accounts` has no `parent_account_id`).
- Audit logging (`fn_audit()`) still doesn't cover `integration_settings`, `workflows`,
  `users`/`roles`, or the new tables added this session (`payments`, `routing_rules`) — actually,
  correction: `payments` and `routing_rules` **were** given audit triggers in this session's
  migrations (0038, 0041). `integration_settings`/`workflows`/`users`/`roles` are still uncovered.
- Meta data-deletion webhook is still a compliance-facing no-op (flagged in the original audit,
  not fixed this session — wasn't part of the requested build order).
