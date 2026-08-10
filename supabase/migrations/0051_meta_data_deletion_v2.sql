-- 0051 Meta Data Deletion — real implementation (was a no-op, see BUILD_BLOCKERS.md).
-- Run after 0001-0050. Idempotent.
--
-- Adds what's needed to actually process a Meta data-deletion callback:
--   - fb_user_id on integration_settings / meta_lead_pages, so a deletion request's
--     Facebook user id can be mapped to the connection(s) it created. Captured going
--     forward by both connection flows (Embedded Signup + Lead Ads OAuth) via a
--     GET /me call right after token exchange. Connections made before this migration
--     have no fb_user_id on file — a deletion request for one of them is logged
--     honestly as "no matching records" (see meta-data-deletion.ts), never fuzzy-matched.
--   - meta_deletion_requests gets a real status lifecycle, an issued_at column (so a
--     replayed signed_request is detected by (facebook_uid, issued_at) instead of
--     minting a duplicate request every retry), a notes column, and a deleted_summary
--     jsonb column (table + row counts only, no PII) for the audit trail.

-- 1. integration_settings / meta_lead_pages: capture the Facebook user who connected. ---
alter table public.integration_settings
  add column if not exists fb_user_id text;
alter table public.meta_lead_pages
  add column if not exists fb_user_id text;

create index if not exists integration_settings_fb_user_idx
  on public.integration_settings (fb_user_id) where fb_user_id is not null;
create index if not exists meta_lead_pages_fb_user_idx
  on public.meta_lead_pages (fb_user_id) where fb_user_id is not null;

-- fb_user_id is treated as sensitive (it's the Meta identifier the whole deletion flow
-- keys on) — deliberately NOT granted to anon/authenticated. The existing REVOKE ALL …
-- GRANT SELECT (named columns) pattern from 0021/0023 already covers this: a new column
-- is never auto-exposed, so no grant statement is needed here to keep it hidden.

-- 2. meta_deletion_requests: real status lifecycle + audit columns. ---------------------
alter table public.meta_deletion_requests
  drop constraint if exists meta_deletion_requests_status_check;
alter table public.meta_deletion_requests
  add constraint meta_deletion_requests_status_check
    check (status in ('pending', 'processing', 'completed', 'failed'));
alter table public.meta_deletion_requests
  alter column status set default 'pending';

alter table public.meta_deletion_requests
  add column if not exists issued_at       timestamptz,
  add column if not exists notes           text,
  add column if not exists deleted_summary jsonb not null default '{}'::jsonb;

-- Dedupe key for replay detection: Meta retries the same signed_request (same
-- facebook_uid + issued_at) if it doesn't get a 200 fast enough. issued_at is nullable
-- (older rows / payloads that omit it), so this is a partial unique index rather than a
-- table constraint — multiple NULLs are fine, Postgres unique indexes already allow that.
create unique index if not exists meta_deletion_requests_uid_issued_idx
  on public.meta_deletion_requests (facebook_uid, issued_at)
  where issued_at is not null;

create index if not exists meta_deletion_requests_status_idx
  on public.meta_deletion_requests (status) where status in ('pending', 'processing');

-- 3. Lock down meta_deletion_requests. ---------------------------------------------------
-- This table was created in 0032 with no RLS and no revoke/grant statements at all —
-- meaning it inherited Supabase's default anon/authenticated ALL grant on new public
-- tables (the same default every other Meta-facing table in this schema explicitly
-- revokes, see 0021/0023 comments). In practice that meant any client holding the anon
-- key could read every facebook_uid on file, or write/forge rows directly. It's accessed
-- exclusively via the service-role admin client on both existing call sites (the callback
-- route and the public status page use createAdminClient(), never a browser client), so
-- closing this off changes no legitimate access path.
revoke all on public.meta_deletion_requests from anon;
revoke all on public.meta_deletion_requests from authenticated;
grant all on public.meta_deletion_requests to service_role;
