# Sirah CRM — Build Specs (Undeveloped & Partial Modules)

Paste-ready build specifications for every **Not started** and **Partial** item in the roadmap. Each spec is self-contained: status, data model, API, UI, build steps, and acceptance criteria. Hand one section at a time to Claude Code.

**Stack assumed:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS) · multi-tenant.

---

## Shared conventions (read once, applies to every spec)

- **Every table** gets: `id uuid primary key default gen_random_uuid()`, `tenant_id uuid not null references tenants(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz`.
- **RLS on every table.** Standard policy pattern:
  ```sql
  alter table <t> enable row level security;
  create policy "tenant_isolation" on <t>
    using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
    with check (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
  ```
- **API routes** live under `src/app/api/...`, validate `tenant_id` from the session, never trust client-supplied tenant.
- **Background work** (anything scheduled or queued) runs on the **Workflow Execution Engine** (Phase 1, item 10) — build that first; most automations below depend on it.
- **Status legend:** 🔴 Not started · 🟡 Partial (what exists is noted).

---

# META GO-LIVE — Critical Path (do first, blocks production)

## 1. Data Deletion Callback Endpoint 🔴  ← MOST URGENT
**Why:** Meta rejects App Review without it. ~1–2 hrs.

**Build:**
- Route: `POST /api/meta/data-deletion`.
- Meta sends a `signed_request` (base64 `signature.payload`). Verify the signature using HMAC-SHA256 with your `META_APP_SECRET`; decode the payload to get `user_id`.
- Delete or anonymize all rows tied to that Meta `user_id` (leads sourced from that user, stored tokens, `meta_lead_events`).
- Respond with JSON: `{ "url": "<status-page-url>?id=<code>", "confirmation_code": "<code>" }`.
- Add a public status page `GET /data-deletion-status?id=` that confirms deletion.

**Acceptance:** Meta's "Send test" on the Data Deletion Request URL returns a valid confirmation URL + code; signature mismatch returns 400.

## 2. Privacy Policy Page 🔴
- Public route `GET /privacy` (no auth). Static content: what data is collected (FB/WhatsApp profile, lead form answers, messages), why, retention, deletion rights, contact email. Must reference Meta, GDPR, India DPDP.
- **Acceptance:** Publicly reachable, no login wall, linked in app footer.

## 3. Terms of Service Page 🔴
- Public route `GET /terms`. Standard SaaS ToS. **Acceptance:** publicly reachable, linked in footer + signup.

## 4. Meta Business Verification 🔴 *(process, no code)*
Checklist: business.facebook.com → Business Settings → Business Info → submit GST cert / incorporation cert / utility bill; verify business phone, website domain, email domain. Timeline 3–7 business days — **start now, runs in parallel.**

## 5. Meta App Review — Lead Ads Permissions 🔴 *(process)*
Request Advanced Access for `leads_retrieval`, `pages_manage_metadata`, `pages_read_engagement`. Prepare: screen recording of the Lead Ads connection flow, written explanation of how lead data is used, list of Pages. Depends on #4.

## 6. Meta App Review — WhatsApp Permissions 🔴 *(process)*
Request Advanced Access for `whatsapp_business_management`, `whatsapp_business_messaging`. Prepare: recording of the send flow in your CRM + opt-in mechanism proof. Depends on #4.

## 7. WhatsApp Template Submission UI 🔴
**Data model:**
```sql
create table whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  category text not null check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  language text not null default 'en',
  body text not null,
  variables jsonb default '[]',
  meta_template_id text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','PENDING','APPROVED','REJECTED')),
  rejection_reason text,
  created_at timestamptz not null default now()
);
```
**API:** `POST /api/whatsapp/templates` (create + submit to Meta via `/{waba_id}/message_templates`), store returned id, set status `PENDING`.
**UI:** Settings → Integrations → WhatsApp → Templates: form (name, category, language, body with `{{1}}` variables), submit button.
**Acceptance:** a submitted template appears in Meta's WABA template list and locally as `PENDING`.

## 8. Template Approval Status Display 🔴
- Poll/receive Meta template status webhook (`message_template_status_update`); update `status` + `rejection_reason`.
- UI: status badge per template (Pending/Approved/Rejected) + reason on hover.
- **Acceptance:** approving a template in Meta flips local status to `APPROVED` within one webhook cycle.

## 9. Meta App — Go Live Switch 🔴 *(milestone)*
After all permissions approved: flip app Development → Live, remove test users. **Acceptance:** a non-test user connects a real Page; a real customer number receives a template.

---

# PHASE 1 — Foundation & Quick Wins

## 10. Workflow Execution Engine 🔴 — FOUNDATION (build first)
**Why:** Rotten Deals, Routing, Sequences, Notifications, Bot handoff all run on this. Schema exists, runner does not.

**Data model:**
```sql
create table workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  trigger_type text not null,      -- 'record.created','record.updated','schedule','event'
  trigger_config jsonb default '{}',
  conditions jsonb default '[]',   -- [{field,op,value}]
  actions jsonb default '[]',      -- [{type,config}]
  is_active boolean default true,
  created_at timestamptz default now()
);
create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  workflow_id uuid not null references workflows(id),
  status text not null default 'pending',  -- pending|running|done|failed
  context jsonb default '{}',
  scheduled_for timestamptz,
  attempts int default 0,
  last_error text,
  created_at timestamptz default now()
);
```
**Engine pieces:**
1. **Trigger sources** — DB triggers (or app-layer hooks on create/update) enqueue a `workflow_runs` row; an event bus for custom events (`lead.replied`, `meeting.booked`).
2. **Scheduler** — a cron worker (Vercel Cron or Supabase `pg_cron` calling an Edge Function) that every minute picks `workflow_runs` where `status='pending' and (scheduled_for is null or scheduled_for<=now())`.
3. **Condition evaluator** — pure function `evaluate(conditions, context) → bool`.
4. **Action executors** — registry mapping `action.type` → handler: `send_email`, `send_whatsapp`, `create_task`, `assign_owner`, `update_field`, `webhook`. Each idempotent.
5. **Retry** — on failure increment `attempts`, exponential backoff, dead-letter after N.

**Build steps:** (1) migrations, (2) enqueue helper, (3) cron worker route `POST /api/workflows/tick` (secured by secret header), (4) evaluator, (5) action registry, (6) retry/backoff, (7) admin UI to list runs + statuses.
**Acceptance:** a workflow "when lead.created, if source=Facebook, assign to round-robin + send WhatsApp" fires end-to-end and is visible in `workflow_runs`; a scheduled action fires at the right minute; failures retry.

## 11. Win-Loss Analysis 🔴
**Exists:** lost-reason field. **Missing:** mandatory capture + analytics.
**Data model:** ensure `deals.lost_reason text`, `deals.lost_notes text`, `deals.closed_at timestamptz`, `deals.outcome text check (outcome in ('won','lost'))`. Tenant-configurable reason list in `settings`.
**API:** marking a deal lost requires `lost_reason`. Report endpoint `GET /api/reports/win-loss?from&to` → aggregates: loss reason counts, win rate by owner, value lost by reason.
**UI:** modal on "Mark Lost" (dropdown + notes); report cards on dashboard.
**Acceptance:** can't close-lost without a reason; report shows correct counts/percentages over a date range.

## 12. Rotten Deals Detection 🔴
**Data model:** add `deals.last_stage_change_at timestamptz`; set it on every stage move. Threshold per pipeline/stage in `pipeline_stages.rotten_after_days int`.
**Engine:** a scheduled workflow (daily) flags deals where `now() - last_stage_change_at > rotten_after_days`; derived flag `is_rotten` (computed, not stored, or cached).
**UI:** red indicator on Kanban card; "Rotten Deals" filtered view; optional one-time notification to owner on first turn-rotten.
**Acceptance:** a deal untouched past threshold shows red and appears in the view; notification fires once, not daily.

## 13. Lead Auto-Assignment / Routing 🔴
**Data model:**
```sql
create table routing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  priority int not null,
  conditions jsonb default '[]',   -- match on source, city, product_interest...
  strategy text not null,          -- 'round_robin'|'territory'|'source'|'load'
  target_user_ids uuid[] default '{}',
  is_active boolean default true
);
create table routing_state (   -- round-robin pointer per rule
  rule_id uuid primary key references routing_rules(id),
  last_index int default -1
);
```
**Logic:** on lead create (Meta/Web/manual) evaluate rules by priority; first match assigns. Round-robin advances `routing_state` atomically (`for update`). No match → fallback (configurable). Respect rep availability flag.
**UI:** rules builder (drag to order), strategy picker.
**Acceptance:** 100 leads distribute evenly under round-robin; territory rule routes by city; unmatched lead hits fallback; assigned rep notified.

## 14. WhatsApp Broadcast Campaigns 🔴
**Exists:** 1-to-1 send pipeline + webhook. **Missing:** bulk + opt-out + tracking. **Blocked on Meta go-live (#1–9).**
**Data model:**
```sql
create table broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text, template_id uuid references whatsapp_templates(id),
  segment jsonb,           -- filter definition
  status text default 'draft', -- draft|queued|sending|done
  created_at timestamptz default now()
);
create table broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid references broadcast_campaigns(id),
  contact_id uuid, phone text,
  variables jsonb,
  status text default 'pending', -- pending|sent|delivered|read|failed|skipped_optout
  error text
);
create table whatsapp_optouts (
  tenant_id uuid not null, phone text not null,
  opted_out_at timestamptz default now(),
  primary key (tenant_id, phone)
);
```
**Send:** queue recipients onto the Workflow Engine; pace sends within tier limits; **exclude `whatsapp_optouts`**; map delivery/read receipts from the existing webhook back to `broadcast_recipients.status`. Detect "STOP/unsubscribe" inbound → insert opt-out.
**UI:** segment selector → template picker → variable mapping → preview → send; campaign dashboard (delivered/read/reply rates).
**Acceptance:** a 200-recipient broadcast sends within limits, opt-outs are skipped, statuses populate, an inbound STOP adds an opt-out and blocks future sends.

## 15. Multi-channel Notifications 🔴
**Exists:** in-app only.
**Data model:** `notification_preferences (tenant_id,user_id,event_type,channel,enabled)`; channels `in_app|email|whatsapp`.
**Logic:** a notification dispatcher (action type on the Workflow Engine) fans out an event to the user's enabled channels. Email via existing mailer; WhatsApp via template to rep's number.
**UI:** per-user preferences matrix (events × channels).
**Acceptance:** "lead assigned" reaches a rep by their chosen channels; disabling a channel stops it.

## 16. Data Import / Migration 🔴
**Goal:** CSV import for leads/contacts/deals with mapping + dedupe.
**Build:** upload CSV → parse (papaparse) → column-to-field mapping UI → validation preview (row errors) → dedupe by email/phone (skip/merge/create) → batched insert with a per-import summary. Store `import_jobs (tenant_id,entity,total,inserted,skipped,failed,status)`.
**Acceptance:** a 5k-row CSV imports with a mapping step, duplicates are handled per chosen policy, and a summary reports counts + downloadable error rows.

---

# PHASE 2 — Engagement & Management

## 17. Email Click Tracking 🟡
**Exists:** open tracking (1×1 pixel) is COMPLETE. **Missing:** click tracking.
**Build:** rewrite outbound links to `GET /api/email/click?t=<token>&u=<encoded_url>`; on hit, log a `email_events (type='click')` row tied to the contact/email, then 302 to the original URL. Reuse the existing open-tracking token scheme.
**Acceptance:** clicking a link in a sent email logs a click event and redirects correctly; malformed token still redirects (fail-safe).

## 18. Sales Sequences 🔴
**Depends on:** Workflow Engine (10) + Email tracking (17).
**Data model:**
```sql
create table sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, name text, is_active boolean default true
);
create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, sequence_id uuid references sequences(id),
  step_order int, channel text,        -- email|whatsapp|task
  delay_hours int, content jsonb
);
create table sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, sequence_id uuid, lead_id uuid,
  current_step int default 0,
  status text default 'active',        -- active|stopped|completed
  next_run_at timestamptz, stop_reason text
);
```
**Logic:** enrol a lead → schedule step 0 on the engine. Each fire: run channel action, advance `current_step`, set `next_run_at = now()+delay`. **Exit conditions** evaluated on every relevant event: lead replies (inbound email/WhatsApp) or books a meeting → set `status='stopped'`. Respect WhatsApp opt-out + template rules.
**UI:** sequence builder (ordered steps, channel, delay, content); enrolment button on a lead; per-lead progress.
**Acceptance:** enrolling a lead fires steps on schedule across channels; a reply halts the sequence immediately; opt-out leads are skipped on WhatsApp steps.

## 19. Automatic Lead Scoring (Rule-based) 🔴
**Depends on:** Email tracking (17).
**Data model:** `lead_scoring_rules (tenant_id,action,points)`; `leads.score int default 0`; recompute on event.
**Logic:** consume engagement events (open +5, 3+ opens +15, click +10, reply +20, quote view +25, meeting +40, no response 7d −10, referral source +30). Decay job reduces stale leads. Cache score; expose as sort/filter.
**Acceptance:** simulated events move a lead's score correctly; inactivity decays it; leaderboard sorts by score.

## 20. Sales Goals & Targets 🔴
**Data model:**
```sql
create table sales_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, user_id uuid, team_id uuid,
  period text,            -- '2026-07' monthly
  metric text,            -- 'revenue'|'deals_won'
  target_value numeric
);
```
**Logic:** actual = aggregate of won deals in period for that user/team. Progress = actual/target. Alert when pace behind (e.g. <expected linear pace).
**UI:** manager sets targets; rep sees progress bar (₹6.2L / ₹10L — 62%); team-vs-target dashboard.
**Acceptance:** setting a target and closing deals updates the rep's progress bar; team view rolls up members.

## 21. Reports — Full Build 🟡
**Exists:** framework only. **Missing:** real reports + builder + export + schedule.
**Build:**
- **Prebuilt reports:** leads (by source/status/conversion/owner), deals (by pipeline/stage/amount/close date), sales performance (revenue by rep/month, win rate), activity (calls/emails/tasks).
- **Custom builder:** pick entity → fields → group-by → filters → sort → chart/table.
- **Export:** CSV + PDF. **Schedule:** a workflow that emails a report PDF on a cadence.
**Acceptance:** each prebuilt report returns correct aggregates; a custom report saves and reloads; a scheduled report emails on time.

## 22. Full Dashboard Enhancement 🟡
**Exists:** basic dashboard. **Missing:** advanced KPIs + team views.
**Build:** KPI tiles (pipeline value, win rate, leads this period, overdue tasks, rotten deals count), trend charts, team leaderboard, role-aware layout (rep sees own, manager sees team). Reuse Reports aggregates.
**Acceptance:** manager and rep see role-appropriate KPIs that match the underlying reports.

## 23. Unified Conversation Inbox 🟡
**Exists:** email + WhatsApp inboxes SEPARATELY. **Missing:** one timeline per contact.
**Build:** a `conversations` view keyed by contact merging email + WhatsApp (and later bot) messages chronologically; unified reply box that routes to the right channel; unread/assignment state. Back it with the existing `communications` log.
**Acceptance:** opening a contact shows all channels in one thread; replying picks the correct channel; new inbound surfaces as unread.

## 24. Activities — Enhance 🟡
**Exists:** basic activities. **Missing:** types, duration, outcomes.
**Data model:** extend `activities` with `type text` (call|email|meeting|note|whatsapp), `duration_minutes int`, `outcome text`, `direction text` (in|out).
**UI:** quick-log with type + outcome; **call logging** (manual log + notes) lives here. Feeds Reports + Scoring.
**Acceptance:** logging a call with duration + outcome appears on the lead timeline and counts in activity reports.

---

# PHASE 3 — Reach, Revenue & Bot

## 25. Bulk Email Campaigns 🔴
**Depends on:** Email tracking (17).
**Build:** segment selector over leads/contacts → personalised template (`{{first_name}}`) → send via a dedicated ESP (Resend/SendGrid) for deliverability → track open/click/reply/unsubscribe (reuse Phase 2 tracking) → suppression list + mandatory unsubscribe link.
**Data model:** `email_campaigns`, `email_campaign_recipients (status: pending|sent|opened|clicked|bounced|unsubscribed)`, `email_suppressions (tenant_id,email)`.
**Acceptance:** a campaign to a segment sends, metrics populate, unsubscribe adds suppression and excludes future sends.

## 26. Meeting Booking Page 🔴
**Depends on:** Calendar (see 39-cal).
**Build:** public per-rep page `GET /book/<rep-slug>` showing free slots derived from the rep's calendar + working hours; on booking → create/update lead, create calendar event, send confirmation, optionally enrol in a reminder sequence. Prevent double-booking (transactional slot lock).
**Acceptance:** a prospect books a free slot; it blocks that time; a lead + event are created; confirmation sent.

## 27. Invoices with GST Compliance 🔴
**Depends on:** Quotations (exists).
**Data model:**
```sql
create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, quotation_id uuid,
  invoice_no text not null,           -- sequential, gap-free per tenant
  place_of_supply text, customer_gstin text,
  subtotal numeric, cgst numeric, sgst numeric, igst numeric,
  round_off numeric, total numeric,
  status text default 'unpaid',       -- unpaid|partial|paid|overdue
  due_date date, created_at timestamptz default now()
);
create table invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, invoice_id uuid,
  description text, hsn_sac text, qty numeric, rate numeric,
  taxable_value numeric, gst_rate numeric
);
```
**Logic:** generate from accepted quotation; **gap-free numbering** via a per-tenant sequence (transactional). **Tax split:** if buyer state = seller state → CGST+SGST else IGST (place-of-supply). Rounding rule. Branded PDF. Credit notes. **Defer e-invoice/IRN.**
**Acceptance:** invoice from a quote has correct CGST/SGST vs IGST by state, sequential number with no gaps, PDF renders, status tracks paid/partial/overdue.

## 28. Payment Collection (UPI / Razorpay) 🔴
**Depends on:** Invoices (27).
**Build:** "Pay Now" link per invoice → Razorpay/Cashfree order → hosted checkout (UPI/card) → **webhook** marks invoice `paid`/`partial` and records `payments (invoice_id,amount,method,ref,paid_at)`. Verify webhook signature.
**Acceptance:** paying via the link flips the invoice to paid through the webhook (not manual), with a payment record + reference.

## 29. WhatsApp Bot — Keyword / Menu (v1) 🔴
**Exists:** inbound receive. **Missing:** bot logic. **[Boss idea]**
**Build:** on inbound message (existing webhook), match against `bot_rules (tenant_id,keyword,response,next_state)`; simple menu state machine per contact (`bot_sessions (contact_id,state)`); auto-reply with template/free-text (respect 24h window). Reuse n8n BRIVOKZ logic where useful.
**Acceptance:** sending "Hi" returns the menu; choosing an option advances state and replies; unknown input falls back gracefully.

## 30. WhatsApp Bot — Visual Flow Builder (v2) 🔴
**Depends on:** Bot v1 (29).
**Build:** drag-drop flow designer (nodes: message, question, condition, action) stored as JSON; runtime interprets the flow per session; **Bot → CRM auto-update** (capture answers into lead fields). Big lift — schedule after v1 proves the channel.
**Acceptance:** a flow built in the UI runs end-to-end and writes captured answers to the lead.

## 31. Human Handoff from Bot 🔴
**Depends on:** Bot v1 (29) + Inbox (23).
**Build:** a bot intent/keyword ("talk to agent") or fallback escalates: mark session `handed_off`, stop bot replies, surface the conversation as unread in the unified inbox + notify an available rep.
**Acceptance:** triggering handoff stops the bot and routes the live thread to a rep.

## 32. Mobile App (PWA first) 🔴
**Build:** add PWA manifest + service worker (installable, offline shell); responsive field workflows (view/update leads & deals, log activity, notifications); mobile conveniences (voice note → activity, click-to-call). Native store build via Capacitor later.
**Acceptance:** installable on Android/iOS home screen; core field actions work; push notifications deliver where supported.

## 33. Enhanced Form Builder 🔴
**Exists:** basic web-to-lead. **Missing:** builder.
**Build:** multi-step forms, conditional logic (show field on prior answer), custom styling, embeddable via iframe/script, thank-you/redirect, reCAPTCHA. Maps submissions → leads (+ routing).
**Acceptance:** a multi-step conditional form embeds on an external site, blocks spam, and creates a routed lead.

---

# PHASE 4 — Premium, Intelligence & Backlog

## 34. AI Email Writer 🔴
**Build:** assemble lead context (name, company, stage, last activity) → call Claude API → return an editable draft body; tone/length options; rep edits before send. Never auto-sends.
**Acceptance:** "Draft follow-up" produces a context-aware draft the rep can edit and send.

## 35. Customer Portal 🔴
**Depends on:** Invoices (27) + Quotations.
**Build:** scoped external auth (isolated from internal tenant data); client can view/approve/reject quotations, view invoices + order status, raise a request that lands in the CRM. Respect tenant branding.
**Acceptance:** an external client logs into a limited portal, approves a quote, views an invoice; no access to internal data.

## 36. Industry Templates + Onboarding Wizard 🔴
**Exists:** basic onboarding.
**Build:** seed packs per industry (real estate, coaching/education, insurance, clinic) — pre-built pipelines, fields, sequences, templates; a setup wizard that applies a pack on tenant creation. Compounds white-label.
**Acceptance:** picking "Real Estate" provisions its pipeline + fields + sequences; tenant is usable in minutes.

## 37. Approval Workflows 🔴
**Depends on:** Workflow Engine (10).
**Build:** rules like "discount > X% needs manager approval" — pause the action, create an approval task, resume on approve / block on reject. `approvals (tenant_id,entity,entity_id,status,approver_id)`.
**Acceptance:** a quote over the threshold blocks until a manager approves, then proceeds.

## 38. Bulk Actions / Mass Update 🔴
**Build:** multi-select on list views → bulk assign / change status / add tag / delete, with a confirm + undo window. Batched, RLS-safe.
**Acceptance:** selecting 50 leads and reassigning updates all in one action with a summary.

## 39. Audit Log / Field History (UI) 🟡
**Exists:** `audit_logs` table. **Missing:** record-level history UI + field-diff capture.
**Build:** write before/after diffs on update; per-record "History" tab showing who changed what, when. Supports DPDP/enterprise trust.
**Acceptance:** editing a field shows the change in that record's history with user + timestamp.

## 39-cal. Calendar — Enhance 🟡
**Exists:** basic UI + iCal export (complete). **Missing:** recurring events, attendee invites, Meet/Zoom link auto-gen, reminders, Google Calendar sync.
**Build:** RRULE recurrence; attendee invite emails (.ics); conferencing link generation; reminder jobs on the engine; optional Google Calendar two-way sync (OAuth, sensitive scope → app verification needed — plan lead time). Required by Meeting Booking Page (26).
**Acceptance:** a recurring event with attendees generates invites + a meet link + reminders; (later) edits sync with Google.

## 40. AI Deal Prediction / Scoring 🔴
**Depends on:** accumulated closed-deal data.
**Build:** once enough history exists, a model estimates close-probability per deal; surface alongside (not replacing) the rule-based score; keep explainable.
**Acceptance:** deals show a probability that correlates with historical outcomes; defer until data volume is sufficient.

## 41. Bot Analytics 🔴
**Depends on:** Bot v1 (29).
**Build:** dashboard of conversation volume, top intents, drop-off points, handoff rate, resolution.
**Acceptance:** bot dashboard shows volume + handoff rate over a date range.

## 42. Duplicate Detection (systematic) 🟡
**Exists:** warning on lead create. **Missing:** systematic detection + merge.
**Build:** fuzzy match on email/phone/name (normalised); a "potential duplicates" view; merge tool that consolidates activities + fields, keeping a survivor.
**Acceptance:** existing duplicates surface in a review list; merge combines records without losing activity history.

## 43. Live-Chat Widget 🔴
**Build:** embeddable JS widget → real-time chat routed to available reps; offline → capture as lead; full transcript logged to the contact + unified inbox.
**Acceptance:** a website visitor chats with a rep (or is captured as a lead offline); transcript appears in the CRM.

## 44. Territory Management 🔴
**Depends on:** Routing Engine (13).
**Build:** define zones (by city/state/pincode) → assign teams → routing + visibility + per-territory reporting. Mostly a config layer over routing.
**Acceptance:** leads route by territory and managers see per-territory performance.

## 45. Auto-Profile Enrichment 🔴
**Build:** optional third-party lookup (Clearbit/Apollo/Hunter) to fill title/company/LinkedIn from email. **Note:** weak data for Indian B2B + per-lookup cost — low ROI, gate behind a tenant toggle.
**Acceptance:** adding a contact by email optionally fills profile fields where data exists.

## 46. Telephony Integration 🔴 — FINAL priority
**Build:** integrate Exotel/Twilio/Knowlarity; click-to-call from any record; auto-log call as an activity (duration + outcome); store + link recordings (consent-aware). Per-call cost + provider dependency.
**Acceptance:** clicking a number places a call, logs it automatically, and links the recording.

---

## Suggested build order (dependency-correct)

1. **Meta go-live (#1–9)** — start Business Verification today (3–7 day external wait); build #1 Data Deletion first.
2. **Workflow Execution Engine (#10)** — unblocks most automation.
3. **Phase 1 quick wins (#11–13, 15–16)**, then **Broadcast (#14)** once Meta clears.
4. **Email click (#17)** → **Sequences (#18)** + **Scoring (#19)**; **Reports (#21)** → **Dashboard (#22)**; **Goals (#20)**; **Inbox (#23)**, **Activities (#24)**.
5. **Phase 3:** Invoices (#27) → Payment (#28); Calendar (#39-cal) → Booking (#26); Bot v1 (#29) → Handoff (#31); Campaigns (#25); PWA (#32).
6. **Phase 4** as capacity allows; Telephony last.

> Each spec is independent enough to hand to Claude Code one at a time. Confirm the "Partial" items against the actual codebase before starting — statuses were inferred from a code read, not a guarantee.
