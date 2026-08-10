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

### 12. Rotten Deals Detection ✅ DONE

**What was built:**
- `stages.rotten_after_days` (nullable — null disables tracking for that stage, e.g. Won/Lost) + `deals.last_stage_change_at` / `deals.rotten_notified_at` (0040)
- `move_deal_stage()` v4 — resets `last_stage_change_at` and clears `rotten_notified_at` on **every** stage change (not just won/lost), so a deal that moves and later goes stale again gets a fresh notification
- `lib/rotten-deals.ts` (`processRottenDeals`) — daily scan (folded into `/api/workflows/tick`) flags open deals past their stage's threshold, notifies the owner once via the existing `notifications` + `fn_should_notify` gate (and therefore automatically flows into the #15 email digest too)
- Settings → Pipelines: "Flag as rotten after N days idle" input per non-won/non-lost stage
- Deals Kanban: amber left-border + "Idle Nd" label on rotten cards, plus a "Rotten (N)" filter toggle in the header

**Acceptance met:** a deal untouched past its stage's threshold shows the amber indicator; the owner is notified once, not daily, and a subsequent stage move + renewed staleness re-fires it.

### 13. Lead Auto-Assignment / Routing ✅ DONE (see BUILD_BLOCKERS.md for 2 scope trims)

**What was built:**
- `routing_rules` / `routing_state` (0041) — matches the spec'd schema; `conditions` is `[{field,operator,value}]` (AND across all, `[]` = catch-all) reusing the workflow engine's own operator vocabulary (`eq/neq/gt/lt/contains/is_empty`) instead of inventing a second one
- `fn_route_lead()` — a `BEFORE INSERT` trigger on `leads`, not application code, specifically because leads are created from **4 different code paths** (manual form, CSV import, Meta Lead Ads webhook, public web-to-lead capture) — a trigger applies the same rule set to all of them with no per-caller duplication, and only fires when `owner_id` is still null so it never overrides an explicit assignment
- `round_robin` (atomic `routing_state` advance via `for update`), `load` (fewest open leads among the eligible reps), `specific` (first rep in the list) strategies
- Settings → Lead Routing: rule list + inline builder (name, numeric priority, condition rows, strategy picker, rep multi-select, active toggle)
- "Territory" is **not** a fourth strategy (the spec's own schema comment listed it alongside `round_robin`/`source`/`load`, which don't compose the same way) — it's a condition on a field, e.g. a tenant-defined `custom_fields.city` custom field, combined with any strategy. Same outcome, no special-cased strategy string.
- "No match → configurable fallback" is modeled as: the tenant creates their own lowest-priority rule with empty conditions, rather than a separate hardcoded fallback concept

**Scope trims (logged in BUILD_BLOCKERS.md):** priority is a plain number input, not drag-to-reorder; there's no synthetic load-test confirming "100 leads distribute evenly" (round-robin's atomicity was verified by reading the `for update` locking, not by running a live batch).

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

### 15. Multi-channel Notifications 🟡 (in-app + email done; WhatsApp not built)

**What was built:**
- `notifications.email_status` (`pending|sent|skipped`) + `email_sent_at` (0039) — every notification row now carries an independent email-delivery decision instead of the dead `notification_preferences.email` column from 0017
- `lib/notification-digest.ts` (`processNotificationEmailDigest`) — groups pending rows per user, checks each user's per-(type,channel) preference, sends **one digest email per user** (not one per event — deliberate UX choice, not just a cron-cadence workaround), marks each row `sent`/`skipped` so it's never rescanned
- Folded into the existing `/api/workflows/tick` daily cron rather than a new cron entry (kept to Vercel's free-tier single daily schedule)
- Settings → Notifications preferences UI now shows **two independent toggles per type** (In-app / Email) instead of one — previously the UI only ever wrote `in_app`, so `email` was unreachable from day one regardless of the column existing
- `invoice_paid` added as a real, user-configurable notification type (was inserted by `fn_record_payment_captured` in 0038 but missing from `NOTIFICATION_TYPE_META`)

**Not built:** WhatsApp as a notification channel (`notification_preferences` only models in_app/email today; adding whatsapp needs a schema change plus reusing `resolveWhatsAppConfig` — deferred, not started)  
**Acceptance met:** disabling in-app for a type stops the bell/list row; enabling email for a type gets it into tomorrow's digest; disabling email stops it. "Instantly" is not met by design — see UX note above.

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

### 17. Email Click Tracking ✅ DONE

**What was built:**
- `GET /api/email/click?t=<open_token>&u=<url>` (0042) — verifies/logs via `fn_email_track_click`, then 302s to `u`. No new `email_events` table (the spec assumed one, but `communications.clicked_at`/`status='clicked'` already existed unused since 0014 — reused it instead)
- A click also backfills `opened_at` if it was never set — a real click is stronger, more reliable signal than the open pixel (many mail clients block remote images by default)
- `lib/email.ts` `bodyToTrackedHtml()` — plain-text emails don't contain `<a href>` tags at all today (compose is textarea → escaped text, no auto-linking), so click tracking had nothing to rewrite until this: it auto-detects bare URLs and wraps them in a tracked redirect link. Wired into both the compose-send path (`email/actions.ts`) and the workflow engine's `send_email` action (`workflow-runner.ts`)
- Redirect target is validated to `http:`/`https:` only (blocks `javascript:`/`data:` etc. — this is a public, unauthenticated endpoint, so it's an open-redirect surface like any ESP's click tracker; scheme validation is the standard mitigation)

**Found + fixed in passing:** `middleware.ts`'s public-route allowlist was missing several server-to-server endpoints (`/api/workflows/tick`, `/api/meta/data-deletion`, `/data-deletion-status`, and this session's new `/api/payments/razorpay/webhook/*`) — they were silently redirecting to `/login` instead of executing, since none of those callers carry a user session. This meant the daily cron (workflow actions, invoice-overdue marking, the rotten-deal scan, and the notification digest) was **not actually running in production** despite being marked done. Fixed; see BUILD_BLOCKERS.md.

**Acceptance met:** clicking a link in a sent email logs the click (and backfills open) and redirects; a missing/invalid token or url still redirects (to `/`) rather than erroring.

### 18. Sales Sequences ✅ DONE (see BUILD_BLOCKERS.md — cadence caveat)

**What was built:**
- `sequences` / `sequence_steps` / `sequence_enrollments` (0043) — matches the spec'd schema closely; added `whatsapp_optouts(tenant_id, phone)` alongside it (needed for the WhatsApp acceptance criterion, and shared with #14 Broadcast Campaigns whenever that's built) and a partial unique index so a lead can't be double-enrolled in the same sequence while already active
- `lib/sequence-runner.ts` (`processSequenceEnrollments`) — for each due enrollment: checks exit conditions, runs the current step's channel action, advances to the next step or completes. Runs from the same daily `/api/workflows/tick` cron as everything else this session (see the cadence caveat below)
- **Exit conditions beyond the literal spec:** the spec said "reply or meeting booked" — meeting booking doesn't exist as a concept anywhere in this codebase (PRD #26, not built), so that's not implemented. Reply detection is real (any inbound `communications` row for the lead since enrollment). Also added: the lead's status moving to `qualified`/`unqualified`/`converted` auto-stops the sequence — a converted or disqualified lead shouldn't keep getting drip messages, and this was a natural, low-risk extension of "exit early" the literal spec didn't call out
- WhatsApp steps check `whatsapp_optouts` before sending and skip silently (not an error) for opted-out numbers. Both inbound webhooks (`cloud/webhook`, `device/webhook/[token]`) now detect `STOP`/`UNSUBSCRIBE`/`OPT OUT`/`CANCEL` (case-insensitive) in an inbound message body and record the opt-out — this is new wiring this session added, not something that existed before
- `fn_enroll_lead_in_sequence(sequence_id, lead_id)` RPC — runs as the calling user (not security definer) so RLS still gates who can enroll whom, unlike most of this session's other new functions
- Settings → Sequences: sequence list, nested ordered step editor (email subject+body / WhatsApp body / task title, each with a "wait N hours" delay, `{{first_name}}`/`{{last_name}}`/`{{company}}` merge fields), reuses the same reorder-by-swap UI pattern as pipeline stages
- Lead detail page: a Sequences card to enroll into any active sequence and see/stop existing enrollments

**Found + fixed in passing:** `communications.owner_id` is `NOT NULL DEFAULT auth.uid()` — under the service-role client (no session, `auth.uid()` is null), inserting without explicitly setting `owner_id` would throw for any lead with no `owner_id` of its own. Fixed in `sequence-runner.ts` by falling back to the enrolling user's id. The pre-existing `workflow-runner.ts` `send_email`/`send_whatsapp` actions have the same gap (no owner_id fallback) — not fixed, since that's a different file with different testing history; logged in BUILD_BLOCKERS.md instead of silently patched.

**Acceptance:** reply halts the sequence (met) · opted-out leads are skipped on WhatsApp steps (met) · "steps fire on schedule" is **not** met literally — see the cadence caveat in BUILD_BLOCKERS.md.

### 19. Automatic Lead Scoring (Rule-based) 🟡 (5 of 7 actions wired; history now surfaced)

**What was built:**
- `lead_scoring_rules(tenant_id, action, points, is_active)` + `lead_score_events` audit log (0044) — every score change is logged, not just applied, so `leads.score` is always reconstructable/explainable
- `fn_apply_lead_score(lead_id, action)` — the single write path (log event + update `leads.score`); falls back to the spec's default points for any tenant/action with no override row, so scoring works immediately for every tenant without a seed migration
- Wired via triggers on `communications` (open/click/reply, using `OLD` vs `NEW` comparison so repeat opens/clicks — already deduped at the source by `fn_email_track_open`/`click` — can't double-score) and `leads` (referral source, matched by `source ilike '%referral%'` since there's no structured referral field)
- Daily inactivity decay (`lib/lead-score-runner.ts`, folded into `/api/workflows/tick`) — only `new`/`contacted` leads with no inbound contact in 7 days, and only once per 7-day window (checked against `lead_score_events`, not a separate "last decayed" column)
- Settings → Lead Scoring: all 7 actions editable (points + on/off), with the 2 unwired ones (see below) visibly flagged rather than silently present
- Leads list: Score column is now a colored pill (green ≥50 / amber ≥20 / slate below) and sortable (click the header to cycle desc → asc → unsorted) — this is the "leaderboard" the acceptance criterion asks for; there isn't a separate leaderboard page

**Not wired (2 of 7 — no underlying event exists in the codebase yet):**
- `quote_viewed` — there's no public/customer-facing quotation view route (Customer Portal, PRD Phase 4, isn't built); `quote_link` in email templates is a label with nothing behind it
- `meeting_scheduled` — no meeting-booking feature exists (PRD #26)

Both are pre-configured in the rules table (with sensible default points) so they activate with zero migration work once their underlying feature ships.

**Acceptance:** inactivity decay met · 5 of 7 event types move the score correctly (2 have no trigger source yet, see above) · sortable score column meets "leaderboard sorts by score" · lead detail page now has a "Score history" card (last 10 `lead_score_events`, action label + signed points + timestamp) — the "why" behind a number is now visible, not just the raw table.

### 20. Sales Goals & Targets ✅ DONE

**What was built:**
- `sales_targets(tenant_id, user_id, period, metric, target_value)` (0045) — `user_id = null` is the whole-tenant ("team") target, since **no `teams` table exists** in this codebase (RBAC is fixed Admin/Manager/Sales Rep, not team-based) and the spec's `team_id` had nothing to reference. Two partial unique indexes prevent duplicate targets for the same rep/team+month+metric (a plain unique constraint doesn't work here — Postgres treats `NULL` as distinct from itself)
- Progress is **computed live** from `deals` (status='won', closed_at in the target's month) every page load — deliberately not stored/denormalized, so it can never drift from the actual won-deal data the way a cached "current progress" column could
- Settings → Sales Targets: Admin sets a target for any rep or the whole team, any month, either metric; edit/delete inline
- Dashboard: reps see their own target(s) as progress bars; managers see the whole-team target plus a per-rep rollup — built as a new `TargetProgress` component (ratio-based color: emerald ≥100%, brand ≥60%, amber below)

**Acceptance met:** closing a deal updates the progress bar (it's a live query, not a cache — always current) · team view rolls up per-rep targets alongside the whole-team one.

### 21. Reports — Full Build 🟡 (prebuilt + export + schedule done; true custom builder still missing)
*(This doc's old note — "framework exists, real reports missing" — was stale. 5 filterable, exportable, saveable prebuilt reports already existed before this session; what was actually missing was PDF export and scheduling, both now built.)*

**What already existed (confirmed, not rebuilt):** Leads / Deals / Tasks / Activities / Sales(Won) reports, each with date-range + column-specific filters, CSV export, and save/reload via `saved_reports`. A separate Win-Loss Analysis report also exists (`/reports/win-loss`, built alongside #11).

**What was built this session:**
- **PDF export** — `(print)/reports/print`, a server-rendered read of the same `REPORT_DEFS` query shape used by the interactive report, with a "Print / Save as PDF" button (the same browser-print pattern already used for quotations/invoices — no new dependency). "Open PDF view" sits next to Export CSV in the report toolbar and carries the current type/date-range/filters via query params
- **Scheduled reports** — `report_schedules` (0046): name, report type, filters, a *relative* date range (`last_7_days`/`last_30_days`/`this_month`/`last_month`/`all_time` — not fixed dates, since a recurring schedule must re-anchor to "now" on every run), cadence (daily/weekly/monthly), recipient emails. `lib/report-scheduler.ts` runs from the daily tick, emails a CSV attachment (see note below) to recipients, tracks `last_sent_at` to avoid re-sending. UI lives right in the Reports page ("Schedule email…" next to Save report)
- Schedule creation is gated to Admin/Manager (recipient emails go to whoever's listed — wider distribution than a personal save, so it's not opened to every rep)

**Not built — true custom report builder:** "pick entity → fields → group-by → filters → sort → chart/table" is a materially different UI (dynamic field/column selection, aggregation, chart rendering) from the existing fixed-column + filter model. The existing 5 reports already give real self-service filtering and were judged good enough for this session's scope; a from-scratch builder is a separate, large feature — not started.

**Acceptance:** prebuilt reports return correct aggregates (unchanged, pre-existing) · CSV export exists (pre-existing) · **PDF export now exists** (browser-print, not a rendered-server-side PDF — see BUILD_BLOCKERS.md) · **scheduled reports email on their cadence** (checked daily, so "daily" can lag up to ~24h — same cron-cadence caveat as everything else this session) · custom report builder (pick fields/group-by/chart) — not met.

### 22. Full Dashboard Enhancement ✅ DONE
*(Most of this was already built pre-session — stale doc again. Pipeline value, weighted forecast, win-rate/lead-conversion/task-completion donuts, pipeline funnel, revenue-by-month trend, lead sources, activities by type, and a sales-by-owner leaderboard all already existed. Only 2 tiles were genuinely missing.)*

**What was added this session:** "Overdue tasks" and "Rotten deals" KPI tiles (both link out to `/tasks`/`/deals`), scoped by `mine` exactly like every other tile — reps see their own overdue/rotten counts, managers see org-wide. The rotten-deals count reads `deals.rotten_notified_at` (built this session, #12), so this tile only became meaningful once that feature existed.

**Acceptance met:** role-aware layout (pre-existing) · KPIs match underlying reports/data (same queries, no separate aggregation path to drift) · manager vs rep views differ correctly.

### 23. Unified Conversation Inbox ✅ DONE (per contact; not lead/account — see below)

**What was built:**
- `communications.is_read` (0047) — the only genuinely missing piece of data; `communications` (0014) already stored both channels in one shape, it just was never surfaced merged anywhere (not even the generic `RecordTimeline` notes/activities/tasks feed)
- Defaults `true` (most insert paths are things the acting rep already saw — they just sent it, or manually logged an inbound email); only the two WhatsApp inbound webhooks (`cloud/webhook`, `device/webhook/[token]`) explicitly set it `false`, since those are the only paths that represent a message nobody's looked at yet
- `ConversationThread.tsx` — a chat-bubble thread (outbound right/brand, inbound left/slate, unread inbound rings amber) merging email + WhatsApp chronologically, on the contact detail page, replacing the old "✉ Email / 💬 WhatsApp" links that just navigated away to the separate inboxes
- A channel-toggle reply box calls the *existing* `sendEmail`/`sendWhatsApp` server actions directly (no new send path) — so it inherits click/open tracking, provider fallback (mailto/wa.me when no provider configured), and communications logging for free
- Opening the thread bulk-marks its unread inbound rows read (same "viewing = read" convention as Notifications, #15)

**Scope trim:** contact-only, as literally spec'd ("opening a **contact**"). Leads and accounts don't get this merged view — they still rely on `RecordTimeline`'s notes/activities/tasks feed without email/WhatsApp folded in. Extending it there would mean either genericizing `ConversationThread` (it's currently contact-specific: `contactEmail`/`contactPhone` props, hardcoded `related_to_type: "contact"`) or duplicating it — not done, flagged in BUILD_BLOCKERS.md.

**Acceptance met:** opening a contact shows all channels in one thread · replying picks the correct channel (channel toggle, not auto-detected from what you're replying to — there's no per-message reply target, just a thread-level channel choice, which is simpler and matches how the rest of this session's messaging UI already works).

### 24. Activities — Enhance ✅ DONE

**What was actually wrong:** call direction/outcome/duration were already captured by the "Log call" tab in `RecordTimeline` — but only as a pipe-delimited string crammed into `activities.subject` (`"outbound|answered|5|discussed pricing"`), decoded client-side just to render one call card. That's invisible to reports, filters, and any other consumer of the table.

**What was built (0048):**
- Real columns: `duration_minutes int`, `outcome text`, `direction text`, each with a check constraint
- Backfill migration that parses every existing encoded `subject` into the new columns and resets `subject` to a clean `"Call"`
- `RecordTimeline`'s call logger now writes the structured columns directly; `encodeCall`/`decodeCall` string-parsing is gone
- New shared `lib/timeline.ts` (`ACTIVITY_SELECT`, `activityToTimelineItem`) — the same activity-fetch-and-map boilerplate was duplicated across all 4 detail pages (leads/contacts/accounts/deals); centralizing it here meant adding the new fields once instead of four times, and any future timeline field only needs to change in one place
- Reports → Activities now has Direction/Outcome/Duration columns and an Outcome filter (`lib/reports.ts`)

**Acceptance met:** logging a call with duration + outcome appears on the record's timeline (unchanged UI, now backed by real columns) and in the Activities report (new).

---

## PHASE 3 — Reach, Revenue & Bot

### 25. Bulk Email Campaigns ✅ DONE

**What was built (0049):**
- `email_campaigns` / `email_campaign_recipients` / `email_suppressions` matching the spec'd shape, plus `fn_resolve_campaign_recipients()` — materializes a campaign's audience (leads or contacts) by evaluating the same `{field,operator,value}` condition shape as Lead Routing (#13), reusing `fn_eval_routing_condition` directly rather than writing a second segment-matching engine
- New shared `components/settings/ConditionsEditor.tsx` — this is the condition-row UI's *third* use (Workflows had its own inline version; Routing had its own; this one was extracted from Routing's copy and both now share it) — worth doing now rather than a fourth copy-paste
- `lib/campaign-runner.ts` (`processEmailCampaigns`), folded into the daily `/api/workflows/tick` cron like every other batch job this session — sends up to 200 pending recipients per campaign per run, so a large campaign drains over a few days rather than timing out one request. Reuses #17's `bodyToTrackedHtml` (click tracking) and the open-tracking pixel automatically
- `/unsubscribe?t=<token>` — a real page (not a bare JSON endpoint), reusing the same `communications.open_token` issued for open/click tracking rather than a new token scheme; every campaign send gets an auto-appended footer link. `fn_email_unsubscribe()` inserts into `email_suppressions`; suppressed emails are marked `skipped` at segment-resolve time and never get a send attempt

**Found + fixed in passing:** `/unsubscribe` and the new webhook-style endpoints needed adding to `middleware.ts`'s public allowlist — same class of bug as the one already logged against #17/#12/#15/#18's cron dependency; see BUILD_BLOCKERS.md. Also caught mid-build: `communications.owner_id` is `NOT NULL DEFAULT auth.uid()`, which is `NULL` under the service-role client used by every cron job — the campaign runner passes the campaign's `owner_id` as an explicit fallback (same fix already applied to the sequence runner, #18).

**Acceptance met:** campaign to a segment sends (batched, not instant) · metrics populate (`sent_count`/`failed_count` on the campaign, per-recipient `status`) · unsubscribe adds a suppression and future campaigns skip that address automatically.

### 26. Meeting Booking Page 🔴
*(Depends on: #39-cal Calendar)*

**Build:** public page `GET /book/<rep-slug>` showing free slots; on booking → create/update lead, create calendar event, send confirmation, enrol in reminder sequence. Prevent double-booking with transactional slot lock.  
**Acceptance:** prospect books a free slot; it blocks that time; lead + event created; confirmation sent

### 27. Invoices with GST Compliance ✅ DONE (credit notes not built)
*(This entry was stale — marked 🔴 despite being fully built pre-session; caught during the initial build audit. Corrected here so future planning doesn't misread it as missing.)*

**What exists (0036, 0037):** `invoices` + `invoice_items` matching this spec's shape, CGST/SGST vs IGST split by place-of-supply, sequential gap-free invoice numbering, HSN/SAC per line, branded PDF (`/invoices/[id]/print`), `payment_status` now wired to real Razorpay collection (#28), and an auto-overdue daily cron (sent + past due date → overdue).

**Not built:** credit notes / refunds — no `credit_note` table or issuance flow. Flagged in the original build audit; still open.

**Acceptance met:** correct CGST/SGST vs IGST by state · sequential invoice number · PDF renders · status tracks unpaid/paid/overdue (no distinct "partial" status — Razorpay links are all-or-nothing per BUILD_BLOCKERS.md).

### 28. Payment Collection (UPI / Razorpay) ✅ DONE

**What was built:**
- `payments` table (invoice_id, amount, currency, method, status, razorpay_payment_link_id, razorpay_payment_id, short_url, paid_at) + `payment_webhook_events` replay-guard ledger
- Per-tenant Razorpay credentials under Settings → Integrations (Key ID, Key secret, Webhook secret), same graceful-degradation pattern as Email/WhatsApp (`lib/payments.ts` → `resolveRazorpayConfig`, tenant config → env fallback → unavailable)
- `createPaymentLink()` server action — generates a Razorpay Payment Link for an invoice's outstanding balance; rep copies/shares it manually (no auto-send)
- `POST /api/payments/razorpay/webhook/[token]` — HMAC-SHA256 signature verification (raw hex, no prefix), idempotent via `payment_webhook_events`, routes to tenant via `webhook_token` (or the shared `env` fallback account)
- `fn_record_payment_captured()` RPC — the only path that can mark a payment/invoice paid; `revoke`d from `public`/`anon`/`authenticated`, `service_role`-only execute, so it is unreachable except from the webhook handler
- Invoice detail page: "Collect payment" button + payment history list (status, amount, copy/open link)
- Notifies the invoice owner on payment received (respects `notification_preferences`, same gate as deal_won/quote_accepted)

**Not built (explicitly out of scope for this pass):** Cashfree as a second gateway, partial-payment reconciliation on a single link, auto-embedding the pay link into `sendInvoiceEmail`, and workflow-engine event emission on payment (skipped to avoid extending `workflows.entity_type` beyond leads/contacts/accounts/deals — a separate, larger change).

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

### 39. Audit Log / Field History UI ✅ DONE

**Correction to this entry:** it claimed field-diff capture was missing — it wasn't. `fn_audit()` (0003) has captured full before/after field diffs on every UPDATE since day one (`changes: {field: {old, new}}` jsonb), plus full snapshots on INSERT/DELETE. Only the UI to surface it was missing, which is what this session actually built.

**What was built:** `components/record/AuditHistory.tsx` — a read-only server component reading `audit_logs` for one entity, resolving actor names via `profiles`, rendering each change as "Status: New → Qualified" per field. Added to all 4 record detail pages (leads/contacts/accounts/deals). Internal columns (`updated_at`, `version`, `custom_fields`) are filtered out of the diff list — `custom_fields` because its diff is a nested jsonb-in-jsonb blob that reads as noise, not a field name a user would recognize.

**Acceptance met:** per-record History section shows who changed what, when — for the 4 entities it was added to. (Other audited tables — `payments`, `routing_rules`, etc. — have the same underlying data but no detail page UI to attach a History section to.)

### 39-cal. Calendar — Enhance 🟡
*(Basic UI + iCal export done. Recurring events, attendee invites, conferencing links, Google Sync are missing.)*
RRULE recurrence; attendee invite emails (.ics); conferencing link generation; reminder jobs on engine; optional Google Calendar two-way sync. Required by Meeting Booking Page (#26).

### 40. AI Deal Prediction / Scoring 🔴
Once enough closed-deal history exists: model estimates close-probability per deal alongside rule-based score. Explainable.

### 41. Bot Analytics 🔴
*(Depends on: #29 Bot v1)*
Dashboard: conversation volume, top intents, drop-off points, handoff rate, resolution.

### 42. Duplicate Detection (systematic) ✅ DONE (exact match only, not fuzzy)
*(This entry was also stale — "warning on lead create exists" wasn't true; the only dedup anywhere was inside the CSV import wizard. Corrected during this build.)*

**What was built (0050):**
- `fn_find_duplicate_leads(email, phone)` — real-time check now wired into manual lead creation (`LeadsClient.tsx`): matching leads are shown as a dismissible warning with a "Create anyway" override, not a hard block
- `fn_scan_duplicate_lead_groups()` — tenant-wide scan grouping leads by normalized (trimmed/lowercased) email or digits-only phone
- `/leads/duplicates` review page + merge tool: pick a primary per group, merge — reassigns notes/activities/tasks/communications/sequence enrollments onto the primary via `fn_merge_leads()`, then soft-deletes the rest (never a hard delete, same convention as everywhere else in this app). Gated to Admin/Manager.
- Match logic is exact-normalized only (same normalization the CSV importer already used), not fuzzy/typo-tolerant (e.g. won't catch "Jon Smith" vs "John Smith") — flagged as a scope trim in BUILD_BLOCKERS.md, not silently claimed as done

**Acceptance:** duplicate warning on create · potential-duplicates view · merge tool consolidating activities + fields — all met for exact email/phone matches; fuzzy name matching is not implemented.

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
