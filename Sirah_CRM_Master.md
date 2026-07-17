# Sirah CRM — Master Documentation

> Combined from: README.md · Sirah_CRM_Build_Specs.md · Branding.md · WhatsApp Embedded Signup spec

---

# Table of Contents

1. [Project Overview](#1-project-overview)
2. [Setup & Installation](#2-setup--installation)
3. [Build Specs — All Modules](#3-build-specs--all-modules)
4. [Organization Branding & White-Label](#4-organization-branding--white-label)
5. [WhatsApp Embedded Signup](#5-whatsapp-embedded-signup)

---

# 1. Project Overview

A multi-tenant Sales CRM built with **Next.js 15 + TypeScript + Tailwind** on **Supabase** (Auth + Postgres + Row-Level Security).

**Stack:** Next.js 15 (App Router) · TypeScript · Supabase (Postgres + RLS) · multi-tenant

**What's built:**
- **Supabase Auth** — login + organization sign-up (creates tenant, roles, default pipeline via RPC)
- **Multi-tenant schema** — `tenant_id` + RLS on every table
- **App shell** — sidebar, top bar, responsive layout
- **Leads** — list, add, inline status change, convert (→ account + contact + deal), soft delete
- **Contacts, Accounts, Deals** — full CRUD + Pipeline Kanban board
- **Tasks, Notes, Activities** — per-record timelines
- **Email** — Resend integration, open tracking pixel, composer
- **WhatsApp** — Cloud API + device API (UltraMsg), inbound webhook
- **Quotations** — with PDF export
- **Products** — catalog
- **Reports** — framework + Win-Loss Analysis
- **Workflows** — DB trigger engine + async queue (workflow_runs)
- **Calendar** — iCal export
- **Data Import** — CSV wizard (leads/contacts/deals)
- **Branding** — per-tenant logo, colors, module labels, visibility
- **Meta Lead Ads** — webhook + data deletion callback

## Project Layout

```
src/
  app/
    login/  signup/                      # auth pages
    (app)/  layout.tsx                   # authenticated shell
            dashboard/  leads/  contacts/
            accounts/  deals/  tasks/
            email/  whatsapp/  calendar/
            reports/  reports/win-loss/
            import/  settings/
    api/
      meta/  email/  whatsapp/
      reports/  workflows/  import/
  components/
    deals/  leads/  contacts/
    reports/  import/  Sidebar.tsx
  lib/
    auth.ts  branding.ts  email.ts
    whatsapp.ts  workflows.ts  types.ts
    integrations.ts  workflow-runner.ts
    supabase/
supabase/migrations/                     # 35 migration files
```

---

# 2. Setup & Installation

## Prerequisites
- Node 18+ and npm
- A free **Supabase** project (https://supabase.com)

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=hello@yourdomain.com

# WhatsApp Cloud API
WHATSAPP_TOKEN=your-token
WHATSAPP_PHONE_ID=your-phone-id
WHATSAPP_VERIFY_TOKEN=your-verify-token

# Meta App
META_APP_SECRET=your-app-secret
NEXT_PUBLIC_FB_APP_ID=your-fb-app-id
NEXT_PUBLIC_FB_CONFIG_ID=your-config-id

# App URL
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# Cron security
CRON_SECRET=random-secret-string
```

## Database Migrations

In Supabase dashboard → **SQL Editor**, paste and run each file in order:

```
supabase/migrations/0001_foundation_identity.sql
supabase/migrations/0002_sales_core.sql
supabase/migrations/0003_activities_custom_audit.sql
supabase/migrations/0004_rpcs.sql
supabase/migrations/0005_seed.sql
supabase/migrations/0006_stamp_tenant.sql
supabase/migrations/0007_rbac_roles.sql
supabase/migrations/0008_custom_fields_rbac.sql
supabase/migrations/0009_workflows.sql
supabase/migrations/0010_tasks_module.sql
supabase/migrations/0011_reports.sql
supabase/migrations/0012_products.sql
supabase/migrations/0013_quotations.sql
supabase/migrations/0014_email.sql
supabase/migrations/0015_whatsapp.sql
supabase/migrations/0016_calendar.sql
supabase/migrations/0017_notifications.sql
supabase/migrations/0018_platform_admin.sql
supabase/migrations/0019_fix_convert_lead.sql
supabase/migrations/0020_lead_company_fields.sql
supabase/migrations/0021_integration_settings.sql
supabase/migrations/0022_platform_console.sql
supabase/migrations/0023_meta_lead_ads.sql
supabase/migrations/0024_organization_branding.sql
supabase/migrations/0025_branding_storage.sql
supabase/migrations/0026_get_login_branding.sql
supabase/migrations/0027_lead_capture_token.sql
supabase/migrations/0028_phase1_gaps.sql
supabase/migrations/0029_sirahagents_events.sql
supabase/migrations/0030_whatsapp_device.sql
supabase/migrations/0031_whatsapp_cloud_inbound.sql
```

**Then run `RUN_ALL_0032_0035.sql`** (combines the 4 newest migrations):
```
supabase/migrations/RUN_ALL_0032_0035.sql
```

## Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:3000 → **Create an organization** → you're in.

## Verify It Works

- Sign up → lands on Dashboard with your org name in the top bar
- Go to **Leads** → Add a lead (needs a name/company and an email/phone)
- Change a lead's status to **qualified** → click **Convert**
- **Tenant isolation:** sign up a second org in incognito — it sees none of the first org's data

---

# 3. Build Specs — All Modules

**Status legend:** ✅ Done · 🔴 Not started · 🟡 Partial

**Shared conventions (applies to every spec):**
- Every table gets: `id uuid primary key default gen_random_uuid()`, `tenant_id uuid not null references tenants(id)`, `created_at timestamptz not null default now()`, `updated_at timestamptz`
- RLS on every table — policy pattern: `using (tenant_id = public.current_tenant_id())`
- API routes live under `src/app/api/...`, validate tenant from session, never trust client-supplied tenant
- Background work runs on the Workflow Execution Engine (item 10)

---

## META GO-LIVE — Critical Path

### 1. Data Deletion Callback Endpoint ✅ DONE
- Route: `POST /api/meta/data-deletion`
- Verifies `signed_request` HMAC-SHA256 with `META_APP_SECRET`
- Responds with `{ url, confirmation_code }`
- Public status page: `GET /data-deletion-status?id=`
- Table: `meta_deletion_requests`

### 2. Privacy Policy Page ✅ DONE
- Public route `GET /privacy` — GDPR, India DPDP, Meta data handling
- Linked from login, signup footer

### 3. Terms of Service Page ✅ DONE
- Public route `GET /terms`
- Linked from login, signup footer

### 4. Meta Business Verification 🔴 *(process, no code)*
- business.facebook.com → Business Settings → Business Info
- Submit GST cert / incorporation cert / utility bill
- Verify business phone, website domain, email domain
- Timeline: 3–7 business days

### 5. Meta App Review — Lead Ads Permissions 🔴 *(process)*
- Request Advanced Access for `leads_retrieval`, `pages_manage_metadata`, `pages_read_engagement`
- Depends on #4

### 6. Meta App Review — WhatsApp Permissions 🔴 *(process)*
- Request Advanced Access for `whatsapp_business_management`, `whatsapp_business_messaging`
- Depends on #4

### 7. WhatsApp Template Submission UI 🔴

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

**API:** `POST /api/whatsapp/templates` — create + submit to Meta via `/{waba_id}/message_templates`  
**UI:** Settings → Integrations → WhatsApp → Templates form (name, category, language, body with `{{1}}` variables)  
**Acceptance:** submitted template appears in Meta's WABA list as `PENDING`

### 8. Template Approval Status Display 🔴
- Receive Meta `message_template_status_update` webhook; update `status` + `rejection_reason`
- UI: status badge per template (Pending/Approved/Rejected) + reason on hover
- **Acceptance:** approving in Meta flips local status to `APPROVED` within one webhook cycle

### 9. Meta App — Go Live Switch 🔴 *(milestone)*
- Flip app Development → Live, remove test users
- **Acceptance:** a non-test user connects a real Page; a real customer receives a template

---

## PHASE 1 — Foundation & Quick Wins

### 10. Workflow Execution Engine ✅ DONE

**What was built:**
- `workflow_runs` table — async queue (pending/running/done/failed) with context JSONB, retry tracking
- Extended action types: `send_email`, `send_whatsapp`, `assign_owner`, `webhook` (in addition to existing `create_task`, `update_field`)
- Extended trigger types: `schedule`, `event`
- Updated `fn_run_workflows()` — sync actions execute in DB trigger; async actions enqueued into `workflow_runs`
- `lib/workflow-runner.ts` — TypeScript executors for all 4 async action types
- `POST /api/workflows/tick` — cron worker (runs every minute via Vercel Cron, secured by `CRON_SECRET`)
- `POST /api/workflows/event` — event bus for custom event triggers
- `vercel.json` — cron schedule

**Cron secret:** Add `CRON_SECRET` env var in Vercel → Settings → Environment Variables

### 11. Win-Loss Analysis ✅ DONE

**What was built:**
- `deals.lost_notes text` column
- `tenants.settings jsonb` — stores `win_loss_reasons` list
- `move_deal_stage()` v3 — accepts `p_lost_notes`
- `get_winloss_report(from_date, to_date)` RPC — returns summary, loss reasons breakdown, win rate by owner
- `get_tenant_settings()` / `update_tenant_settings()` RPCs
- Mark Lost modal upgraded: dropdown of reasons (8 defaults or tenant-configured) + notes field
- `/reports/win-loss` — report page with date filter, stat cards, reason bars, rep table
- Reports page card linking to win-loss

**To configure your own reasons:**
```sql
select update_tenant_settings('{"win_loss_reasons": ["Pricing", "Competitor", "No budget", "Bad timing"]}');
```

### 12. Rotten Deals Detection 🔴

**Data model:**
```sql
alter table deals add column last_stage_change_at timestamptz;
-- per pipeline stage:
alter table pipeline_stages add column rotten_after_days int;
```

**Engine:** scheduled workflow (daily) flags deals where `now() - last_stage_change_at > rotten_after_days`  
**UI:** red indicator on Kanban card; "Rotten Deals" filtered view; one-time notification to owner  
**Acceptance:** deal untouched past threshold shows red; notification fires once, not daily

### 13. Lead Auto-Assignment / Routing 🔴

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
create table routing_state (
  rule_id uuid primary key references routing_rules(id),
  last_index int default -1
);
```

**Logic:** on lead create, evaluate rules by priority; first match assigns. Round-robin advances `routing_state` atomically (`for update`). No match → configurable fallback.  
**UI:** rules builder (drag to order), strategy picker  
**Acceptance:** 100 leads distribute evenly under round-robin; territory rule routes by city; unmatched lead hits fallback

### 14. WhatsApp Broadcast Campaigns 🔴
*(Blocked on Meta go-live #1–9)*

**Data model:**
```sql
create table broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text, template_id uuid references whatsapp_templates(id),
  segment jsonb,
  status text default 'draft',     -- draft|queued|sending|done
  created_at timestamptz default now()
);
create table broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  campaign_id uuid references broadcast_campaigns(id),
  contact_id uuid, phone text, variables jsonb,
  status text default 'pending',   -- pending|sent|delivered|read|failed|skipped_optout
  error text
);
create table whatsapp_optouts (
  tenant_id uuid not null, phone text not null,
  opted_out_at timestamptz default now(),
  primary key (tenant_id, phone)
);
```

**UI:** segment selector → template picker → variable mapping → preview → send; campaign dashboard  
**Acceptance:** 200-recipient broadcast sends within limits, opt-outs skipped, inbound STOP adds opt-out

### 15. Multi-channel Notifications 🔴

**Data model:** `notification_preferences (tenant_id, user_id, event_type, channel, enabled)` — channels: `in_app|email|whatsapp`  
**Logic:** notification dispatcher fans out to user's enabled channels via existing mailer/WhatsApp  
**UI:** per-user preferences matrix (events × channels)  
**Acceptance:** "lead assigned" reaches rep by their chosen channels; disabling a channel stops it

### 16. Data Import / Migration ✅ DONE

**What was built:**
- `import_jobs` table — tracks status, counts (inserted/updated/skipped/failed)
- `import_errors` table — per-row errors, downloadable as CSV
- `POST /api/import/run` — field mapping, validation, dedupe (skip/merge/create), bulk insert in 200-row chunks
- `GET /api/import/errors?job_id=` — download error rows as CSV
- `ImportWizard` — 5-step UI: Entity → Upload (papaparse) → Map fields (auto-match + manual, 5-row preview) → Options (dedupe) → Done (result cards + error download)
- Sidebar: "Data Import" link under Admin

**Supported entities:** leads, contacts, deals  
**Dedupe fields:** email or phone (for leads/contacts)  
**Policies:** skip, merge (update existing), always create

---

## PHASE 2 — Engagement & Management

### 17. Email Click Tracking 🟡
*(Open tracking pixel is DONE. Click tracking is missing.)*

**Build:** rewrite outbound links to `GET /api/email/click?t=<token>&u=<encoded_url>`; on hit, log `email_events (type='click')`, then 302 to original URL. Reuse existing open-tracking token scheme.  
**Acceptance:** clicking a link in a sent email logs a click event and redirects; malformed token still redirects

### 18. Sales Sequences 🔴
*(Depends on: #10 Workflow Engine + #17 Email tracking)*

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

**Logic:** enrol lead → schedule step 0. Each fire: run action, advance step, set next_run_at. Exit on reply or meeting booked.  
**Acceptance:** steps fire on schedule; reply halts sequence immediately; opt-out leads skipped on WhatsApp steps

### 19. Automatic Lead Scoring (Rule-based) 🔴
*(Depends on: #17 Email tracking)*

**Data model:** `lead_scoring_rules (tenant_id, action, points)`; `leads.score int default 0`  
**Logic:** open +5, click +10, reply +20, quote view +25, meeting +40, no response 7d −10, referral +30; decay on stale  
**Acceptance:** simulated events move score correctly; inactivity decays it; leaderboard sorts by score

### 20. Sales Goals & Targets 🔴

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

**UI:** manager sets targets; rep sees progress bar (₹6.2L / ₹10L — 62%); team-vs-target dashboard  
**Acceptance:** closing deals updates rep's progress bar; team view rolls up members

### 21. Reports — Full Build 🟡
*(Framework exists. Real reports + builder + export + schedule are missing.)*

**Build:**
- Prebuilt reports: leads (by source/status/conversion/owner), deals (by pipeline/stage/amount), sales performance (revenue by rep/month, win rate), activity (calls/emails/tasks)
- Custom builder: pick entity → fields → group-by → filters → sort → chart/table
- Export: CSV + PDF
- Schedule: workflow that emails a report PDF on a cadence

**Acceptance:** each prebuilt report returns correct aggregates; custom report saves and reloads; scheduled report emails on time

### 22. Full Dashboard Enhancement 🟡
*(Basic dashboard exists. Advanced KPIs + team views are missing.)*

**Build:** KPI tiles (pipeline value, win rate, leads this period, overdue tasks, rotten deals count), trend charts, team leaderboard, role-aware layout  
**Acceptance:** manager and rep see role-appropriate KPIs that match underlying reports

### 23. Unified Conversation Inbox 🟡
*(Email + WhatsApp inboxes exist separately. One timeline per contact is missing.)*

**Build:** `conversations` view merging email + WhatsApp chronologically per contact; unified reply box routing to the right channel; unread/assignment state  
**Acceptance:** opening a contact shows all channels in one thread; replying picks the correct channel

### 24. Activities — Enhance 🟡
*(Basic activities exist. Types, duration, outcomes are missing.)*

**Data model:** extend `activities` with `type text` (call|email|meeting|note|whatsapp), `duration_minutes int`, `outcome text`, `direction text` (in|out)  
**UI:** quick-log with type + outcome; call logging with notes  
**Acceptance:** logging a call with duration + outcome appears on lead timeline and in activity reports

---

## PHASE 3 — Reach, Revenue & Bot

### 25. Bulk Email Campaigns 🔴
*(Depends on: #17 Email tracking)*

**Build:** segment selector → personalised template → send via Resend → track open/click/reply/unsubscribe → suppression list  
**Data model:** `email_campaigns`, `email_campaign_recipients`, `email_suppressions (tenant_id, email)`  
**Acceptance:** campaign to a segment sends, metrics populate, unsubscribe adds suppression

### 26. Meeting Booking Page 🔴
*(Depends on: #39-cal Calendar)*

**Build:** public page `GET /book/<rep-slug>` showing free slots; on booking → create/update lead, create calendar event, send confirmation, enrol in reminder sequence. Prevent double-booking with transactional slot lock.  
**Acceptance:** prospect books a free slot; it blocks that time; lead + event created; confirmation sent

### 27. Invoices with GST Compliance 🔴
*(Depends on: Quotations — exists)*

**Data model:**
```sql
create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null, quotation_id uuid,
  invoice_no text not null,
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

**Tax split:** same state → CGST+SGST; different state → IGST. Gap-free numbering. Branded PDF. Credit notes.  
**Acceptance:** correct CGST/SGST vs IGST by state, sequential invoice number, PDF renders, status tracks paid/partial/overdue

### 28. Payment Collection (UPI / Razorpay) 🔴
*(Depends on: #27 Invoices)*

**Build:** "Pay Now" link → Razorpay/Cashfree order → hosted checkout → webhook marks invoice paid → records `payments (invoice_id, amount, method, ref, paid_at)`. Verify webhook signature.  
**Acceptance:** paying via link flips invoice to paid through webhook, with payment record + reference

### 29. WhatsApp Bot — Keyword / Menu (v1) 🔴

**Build:** on inbound message, match `bot_rules (tenant_id, keyword, response, next_state)`; menu state machine per contact (`bot_sessions (contact_id, state)`); auto-reply respecting 24h window.  
**Acceptance:** "Hi" returns menu; choosing an option advances state; unknown input falls back

### 30. WhatsApp Bot — Visual Flow Builder (v2) 🔴
*(Depends on: #29 Bot v1)*

**Build:** drag-drop flow designer (nodes: message, question, condition, action) stored as JSON; runtime interprets flow per session; captures answers into lead fields  
**Acceptance:** a flow built in UI runs end-to-end and writes captured answers to the lead

### 31. Human Handoff from Bot 🔴
*(Depends on: #29 Bot v1 + #23 Inbox)*

**Build:** keyword "talk to agent" or fallback → mark session `handed_off`, stop bot replies, surface conversation as unread in unified inbox + notify rep  
**Acceptance:** triggering handoff stops the bot and routes live thread to a rep

### 32. Mobile App (PWA first) 🔴

**Build:** PWA manifest + service worker (installable, offline shell); responsive field workflows; voice note → activity; click-to-call. Native store build via Capacitor later.  
**Acceptance:** installable on Android/iOS; core actions work; push notifications deliver

### 33. Enhanced Form Builder 🔴

**Build:** multi-step forms, conditional logic, custom styling, embeddable via iframe/script, thank-you/redirect, reCAPTCHA. Maps submissions → leads + routing.  
**Acceptance:** multi-step conditional form embeds on external site, blocks spam, creates a routed lead

---

## PHASE 4 — Premium, Intelligence & Backlog

### 34. AI Email Writer 🔴
Assemble lead context → call Claude API → return editable draft body; tone/length options; rep edits before send. Never auto-sends.

### 35. Customer Portal 🔴
*(Depends on: #27 Invoices + Quotations)*
Scoped external auth; client views/approves/rejects quotations, views invoices, raises requests. Respects tenant branding.

### 36. Industry Templates + Onboarding Wizard 🔴
Seed packs per industry (real estate, coaching, insurance, clinic) — pre-built pipelines, fields, sequences, templates; setup wizard applies pack on tenant creation.

### 37. Approval Workflows 🔴
*(Depends on: #10 Workflow Engine)*
Rules like "discount > X% needs manager approval" — pause action, create approval task, resume on approve. `approvals (tenant_id, entity, entity_id, status, approver_id)`

### 38. Bulk Actions / Mass Update 🔴
Multi-select on list views → bulk assign / change status / add tag / delete, with confirm + undo window. Batched, RLS-safe.

### 39. Audit Log / Field History UI 🟡
*(Table exists. UI + field-diff capture is missing.)*
Write before/after diffs on update; per-record "History" tab showing who changed what, when.

### 39-cal. Calendar — Enhance 🟡
*(Basic UI + iCal export done. Recurring events, attendee invites, conferencing links, Google Sync are missing.)*
RRULE recurrence; attendee invite emails (.ics); conferencing link generation; reminder jobs on engine; optional Google Calendar two-way sync. Required by Meeting Booking Page (#26).

### 40. AI Deal Prediction / Scoring 🔴
Once enough closed-deal history exists: model estimates close-probability per deal alongside rule-based score. Explainable.

### 41. Bot Analytics 🔴
*(Depends on: #29 Bot v1)*
Dashboard: conversation volume, top intents, drop-off points, handoff rate, resolution.

### 42. Duplicate Detection (systematic) 🟡
*(Warning on lead create exists. Systematic detection + merge is missing.)*
Fuzzy match on email/phone/name; "potential duplicates" view; merge tool consolidating activities + fields.

### 43. Live-Chat Widget 🔴
Embeddable JS widget → real-time chat routed to available reps; offline → capture as lead; full transcript logged to contact + unified inbox.

### 44. Territory Management 🔴
*(Depends on: #13 Routing)*
Define zones (city/state/pincode) → assign teams → routing + visibility + per-territory reporting.

### 45. Auto-Profile Enrichment 🔴
Optional third-party lookup (Clearbit/Apollo) to fill title/company/LinkedIn from email. Tenant toggle.

### 46. Telephony Integration 🔴 — FINAL priority
Integrate Exotel/Twilio/Knowlarity; click-to-call from any record; auto-log call as activity (duration + outcome); store + link recordings (consent-aware).

---

## Suggested Build Order

1. **Meta go-live (#1–9)** — start Business Verification today (3–7 day external wait); #1 Data Deletion is DONE
2. **Workflow Engine (#10)** ✅ DONE — unblocks most automation
3. **Phase 1 quick wins (#11 ✅, #12, #13, #15, #16 ✅)** — then Broadcast (#14) once Meta clears
4. **Email click (#17) → Sequences (#18) + Scoring (#19); Reports (#21) → Dashboard (#22); Goals (#20); Inbox (#23); Activities (#24)**
5. **Phase 3:** Invoices (#27) → Payment (#28); Calendar (#39-cal) → Booking (#26); Bot v1 (#29) → Handoff (#31); Campaigns (#25); PWA (#32)
6. **Phase 4** as capacity allows; Telephony last

---

# 4. Organization Branding & White-Label

## Purpose

Every tenant should feel like they own the software — not that they're using "Sirah CRM" but their own CRM.

Examples: ABC Hospital CRM · XYZ Construction CRM · Bright Future Academy CRM

## Levels of Customization

### Level 1 — Company Branding (MVP) ✅ DONE
- **Company Logo** — used in login page, sidebar, top nav, dashboard, PDF quotations, reports, emails
- **Favicon** — browser tab becomes company-specific
- **Company Name** — displayed throughout the CRM
- **Browser Title** — custom browser tab title

### Level 2 — Theme & Appearance ✅ DONE (partial)
- **Primary Color** — buttons, links, active sidebar, charts, progress bars, toggles
- **Secondary / Accent Color** — badges, highlights, notifications, secondary buttons
- **Sidebar Theme** — Dark / Light / Auto
- **Navigation Style** — Classic Sidebar / Collapsed / Top Nav / Hybrid
- **Border Radius** — Square / Rounded / Modern Rounded
- **Density** — Compact / Comfortable / Spacious
- **Font Family** — Inter / Roboto / Poppins / Open Sans

### Level 3 — Login Experience ✅ DONE
- Login Logo, Background Image, Welcome Message, Company Description

### Level 4 — Dashboard Customization 🔴
- Configurable widgets: Revenue, Leads, Deals, Tasks, Calendar, Activities, Notifications, Reports
- Drag-and-drop widget arrangement

### Level 5 — CRM Terminology ✅ DONE
Tenant admins can rename modules. Example mappings:

| Default  | Hospital   | Education    | Real Estate | Recruitment |
|----------|------------|--------------|-------------|-------------|
| Leads    | Patients   | Students     | Buyers      | Candidates  |
| Contacts | Doctors    | Parents      | Owners      | Applicants  |
| Deals    | Treatments | Admissions   | Properties  | Placements  |
| Accounts | Hospitals  | Institutions | Agencies    | Clients     |

### Level 6 — Module Visibility ✅ DONE
Tenant admins can enable or disable modules. Changes reflect in sidebar, headers, buttons.

### Level 7 — Pipeline Customization ✅ DONE
Every organization builds its own sales pipeline with custom stages.

### Level 8 — Status Customization 🔴
Tenant-defined statuses (e.g., "Patient Registered" instead of "New").

### Level 9 — Custom Icons 🔴
Each module may have a custom icon per industry.

### Level 10 — Email Branding 🟡
Emails use company logo, brand colors, footer, signature, contact info.

### Level 11 — PDF Branding ✅ DONE (partial)
Quotation PDFs include company logo. Full color/watermark/footer coming.

### Level 12 — Custom Domain 🔴 *(Future)*
`crm.abchospital.com` instead of `crm.sirah.com`

### Level 13 — AI Branding 🔴 *(Future)*
Rename AI assistant per organization (e.g., "Medi Assistant", "Build AI")

### Level 14 — Mobile Branding 🔴 *(Future)*
Custom app name, splash screen, logo, colors, icons

## Database Design

```sql
-- Table: organization_branding (implemented as tenant_branding in this codebase)
tenant_id           uuid
company_name        text
logo_url            text
favicon_url         text
primary_color       text
secondary_color     text
font_family         text
sidebar_theme       text
navigation_style    text
border_radius       text
density             text
login_background_url text
welcome_message     text
browser_title       text
module_labels       jsonb    -- {"leads": "Patients", "deals": "Treatments"}
module_visibility   jsonb    -- {"products": false, "quotations": true}
dashboard_layout    jsonb
status_labels       jsonb
pipeline_settings   jsonb
pdf_settings        jsonb
email_settings      jsonb
created_at          timestamptz
updated_at          timestamptz
```

## Permissions
- Only **Tenant Admins** can modify branding
- Every user under the tenant automatically receives updated branding

---

# 5. WhatsApp Embedded Signup

> **Status:** 🟡 To build  
> **Goal:** Tenant admin clicks one button, logs in with their Facebook, connects their WhatsApp number, CRM auto-saves credentials per-tenant — no manual token/ID copying.

## ⚠️ What This Requires from Meta (their clock — weeks)
- **Tech Provider** status (app dashboard application)
- **App Review** approval with screen recording of the flow
- **Business Verification** of Sirah

**You CAN build + test today** using your own Facebook account or a Meta sandbox test account.

Use **Embedded Signup v4** (v2 deprecated Oct 15 2026).

## Meta-side Prerequisites

1. Facebook Login for Business → Settings → Client OAuth settings: add your domains to **Allowed Domains** and **Valid OAuth Redirect URIs**
2. Facebook Login for Business → Configurations → Create from template → "WhatsApp Embedded Signup Configuration With 60 Expiration Token" → **Record the Configuration ID**
3. Note your **Facebook App ID** and **App Secret**

**Env vars:**
```
NEXT_PUBLIC_FB_APP_ID    = <your Facebook App ID>
NEXT_PUBLIC_FB_CONFIG_ID = <Configuration ID from step 2>
FB_APP_SECRET            = <your App Secret>  # server-only
```

## How the Flow Works

```
Tenant clicks "Connect WhatsApp" in CRM settings
  → FB JS SDK opens Embedded Signup popup
  → tenant logs in with THEIR Facebook, picks/creates THEIR WhatsApp number
  → popup returns:
       (a) exchangeable code       (via FB.login callback)
       (b) waba_id + phone_number_id  (via window 'message' event)
  → frontend POSTs {code, waba_id, phone_number_id} to backend
  → backend: exchange code → access token → register number → subscribe WABA to webhook
           → save phone_id + waba_id + token into integration_settings for THIS tenant
  → done — tenant connected, their number, their WABA
```

## Build Steps

### 1. Frontend — "Connect WhatsApp" button

Add to `IntegrationsClient.tsx` / WhatsApp Cloud card:

```js
// Load FB SDK once
FB.init({ appId: NEXT_PUBLIC_FB_APP_ID, version: 'v22.0', xfbml: false, cookie: true });

// Message listener — captures waba_id + phone_number_id
window.addEventListener("message", (event) => {
  if (!["https://www.facebook.com","https://web.facebook.com"].includes(event.origin)) return;
  try {
    const data = JSON.parse(event.data);
    if (data.type === "WA_EMBEDDED_SIGNUP" && ["FINISH","FINISH_ONLY_WABA"].includes(data.event)) {
      window.__waSignup = { waba_id: data.data.waba_id, phone_number_id: data.data.phone_number_id };
    }
  } catch {}
});

function launchWhatsAppSignup() {
  FB.login(function (response) {
    if (response.authResponse?.code) {
      const { code } = response.authResponse;
      const { waba_id, phone_number_id } = window.__waSignup || {};
      // Call connectWhatsAppEmbedded({ code, waba_id, phone_number_id })
    }
  }, {
    config_id: NEXT_PUBLIC_FB_CONFIG_ID,
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {}, featureType: "", sessionInfoVersion: 3 }
  });
}
```

### 2. Backend — `connectWhatsAppEmbedded()` server action

**File:** `src/app/(app)/settings/integrations/embedded-signup-actions.ts`

Steps:
1. Exchange code for access token: `GET https://graph.facebook.com/v22.0/oauth/access_token?client_id=...&client_secret=...&code=...`
2. Subscribe WABA to your app: `POST https://graph.facebook.com/v22.0/{waba_id}/subscribed_apps` with Bearer token
3. Register phone number: `POST https://graph.facebook.com/v22.0/{phone_number_id}/register` with `{ messaging_product: "whatsapp", pin: "<6-digit>" }`
4. Save to `integration_settings` for this tenant (channel='whatsapp'): `phone_id`, `business_account_id`, `access_token`, `is_enabled=true`

### Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `IntegrationsClient.tsx` — add SDK load + Connect button + launcher |
| Create | `src/app/(app)/settings/integrations/embedded-signup-actions.ts` |
| Reuse  | existing `integration_settings`, webhook, send code (no changes) |

## Test Plan
1. Set the 3 env vars
2. Open CRM settings → click **Connect WhatsApp**
3. Complete popup using your own Facebook or Meta sandbox test account
4. Confirm: `integration_settings` row has `phone_id`, `business_account_id`, `access_token`, `is_enabled=true` — all auto-filled
5. Send a test message from the CRM using the connected number

## After Building (Meta Submissions)
1. Apply: **Become a Tech Provider**
2. **Business Verification** (Sirah's documents)
3. **App Review** — submit with screen recording of the Connect flow
4. On approval → real external tenants can self-connect (up to ~10 per 7-day window initially)
