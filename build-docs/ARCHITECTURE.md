# Architecture

Written after the fact (2026-11-06) and deliberately narrow: it covers the Meta Lead Ads
ingestion path, the part this folder's first feature touched. Broader system design still lives in
`Sirah_CRM_Master.md` and `Sirah_CRM_Build_Specs.md`.

## Stack
Next.js (App Router) + TypeScript + Tailwind on Supabase (Auth, Postgres, RLS).
Multi-tenant: every table carries `tenant_id` and is RLS-scoped to `current_tenant_id()`.

## Meta Lead Ads: data flow

```
Admin ──OAuth──> /api/meta/oauth/callback ──> meta_lead_pages (page_id → tenant_id + Page token)
                                                     │ subscribe to `leadgen`
Person submits instant form on FB/IG
        │
        ▼
Meta POST /api/meta/leadgen
        │ 1. verify X-Hub-Signature-256 (HMAC-SHA256, app secret)
        │ 2. claim leadgen_id in meta_lead_events  ← unique constraint = idempotency
        │ 3. page_id → tenant + Page token
        │ 4. Graph: lead answers, then form name, then ad name (3 + 4 best-effort)
        │ 5. insert into leads (service role, explicit tenant_id)
        ▼
leads.custom_fields = { ...form answers, fb_* routing metadata }
        │
        ├─> /leads list            (Ad column + ad-form / ad filters)
        ├─> /leads/[id]            (Facts card + captured answers)
        └─> /api/export/facebook-leads  (JSON + CSV pull feed, API-key auth, rate-limited)
```

The same webhook URL also receives `messages`/`feed` events (Meta permits one callback URL per
webhook object) and forwards the raw body to the Instagram handler.

## Module boundaries
- `src/lib/meta.ts` — **server-only** (throws if imported in the browser). All Graph API calls,
  OAuth URL building, signature verification, and form-field → lead mapping.
- `src/lib/lead-feed.ts` — the pull feed's stable public shape (`FeedLead`), CSV building with
  formula-injection escaping, key hashing, cursor/limit parsing. Pure and unit-tested.
- `src/lib/supabase/admin.ts` — service-role client. The only reader of Page access tokens.
- `src/app/api/meta/*` — webhook + OAuth routes; always answer 200 to Meta so it stops retrying.
- Client components import types and server actions, never `lib/meta.ts`.

## Security model
- Page access tokens are secrets. RLS cannot mask a column, so `0023_meta_lead_ads.sql` revokes all
  privileges on `meta_lead_pages` from `anon`/`authenticated` and grants back only the non-secret
  columns. `access_token` is never granted to a client role.
- The pull feed has no session: it is allow-listed in middleware and authorised by a per-tenant API
  key stored only as a SHA-256 hash, rate-limited per key, and fails closed if the limiter errors.
- Lead answers and ad names are attacker/advertiser-controlled text; CSV cells starting with
  `= + - @` are prefixed with `'` to stop Excel/Sheets executing them.
