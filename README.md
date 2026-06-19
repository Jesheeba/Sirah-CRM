# CRM App — MVP (Foundation + Leads slice)

A multi-tenant Sales CRM built with **Next.js + TypeScript + Tailwind** on **Supabase**
(Auth + Postgres + Row-Level Security). This is the first vertical slice: sign-up/onboarding,
the app shell, and **Leads end-to-end**. Specs live in [`../docs/`](../docs).

## What's in this slice
- **Supabase Auth** login + organization sign-up (creates tenant, roles, default pipeline via RPC).
- **Multi-tenant** schema with `tenant_id` + RLS on every table (see `supabase/migrations/`).
- **App shell** — sidebar + top bar (Contacts/Accounts/Deals are stubbed "coming soon").
- **Leads** — list, add, inline status change, **convert** (→ account + contact + deal), soft delete.

## Prerequisites
- Node 18+ (you have v24) and npm.
- A free **Supabase** project (https://supabase.com) — no Docker needed.

## Setup

1. **Create a Supabase project**, then open **Project Settings → API** and copy the
   `Project URL` and the `anon public` key.

2. **Configure env:** edit `.env.local` and replace the placeholders:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
   ```

3. **Run the database migrations.** In the Supabase dashboard → **SQL Editor**, paste and run
   each file in order:
   ```
   supabase/migrations/0001_foundation_identity.sql
   supabase/migrations/0002_sales_core.sql
   supabase/migrations/0003_activities_custom_audit.sql
   supabase/migrations/0004_rpcs.sql
   supabase/migrations/0005_seed.sql
   supabase/migrations/0006_stamp_tenant.sql
   ```
   (Or, with the Supabase CLI linked: `supabase db push`.)

4. **For fast local testing, disable email confirmation:** Supabase dashboard →
   **Authentication → Providers → Email →** turn **off** "Confirm email". (With it on, sign-up
   sends a confirmation link; after confirming and logging in you'll be asked for your org name.)

5. **Install & run:**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000 → **Create an organization** → you're in.

## Verify it works
- Sign up → lands on Dashboard with your org name in the top bar.
- Go to **Leads** → Add a lead (needs a name/company **and** an email/phone).
- Change a lead's status to **qualified** → click **Convert** → it becomes "Converted"
  (an account, contact, and deal are created behind the scenes).
- **Tenant isolation:** sign up a second org in an incognito window — it sees none of the first org's leads.

## Project layout
```
src/
  app/
    login/  signup/  onboarding/        # auth
    (app)/  layout.tsx                  # authenticated shell (sidebar + top bar)
            dashboard/  leads/          # pages
    auth/signout/route.ts
  components/  Sidebar  TopBar  leads/LeadsClient
  lib/supabase/  client  server  middleware
supabase/migrations/                    # the database
```

## Next steps
Replicate the Leads pattern for **Contacts, Accounts, Deals** (+ the Pipeline board), then add
Tasks/Notes/Activities and custom fields. See [`../docs/mvp-prd.md`](../docs/mvp-prd.md) and
[`../docs/wireframes.md`](../docs/wireframes.md).
