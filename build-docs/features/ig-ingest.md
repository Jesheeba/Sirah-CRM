# F2 — Webhook + tag ingestion

## Purpose
Receive every comment, @mention and tagged post for a connected account, reliably and once.

## Architecture
- `POST /api/ig/webhook` (+ GET verify). Verify `X-Hub-Signature-256` on the raw body first; always 200.
- Events: `comments` (comment on our media), `mentions` (@mention in a comment/caption), `messages` (inbound DMs, stored as kind `dm`
  with the sender's last-message time for the 24 h window).
  Mention → fetch detail via Graph (`mentioned_comment` / `mentioned_media`) with the account token.
- Tagged posts: no webhook → poll `GET /{ig-user-id}/tags`. The cron (`vercel.json`) runs **once a day**, so tags arrive daily plus a manual "Refresh" in the inbox (F3, `pollIgTags({tenantId})`). Newest 25 per poll; known ids are skipped, so no cursor is stored.
- Table `ig_interactions`: tenant_id, ig_account_id, kind (comment/mention/tag), provider_id (unique per account),
  author_handle, author_id, text, media_id, media_url/permalink, parent_id, created_at_provider, received_at,
  status (new/assigned/replied/ignored/issue), assigned_to, raw jsonb.
- Idempotent on (ig_account_id, provider_id). Own-account comments are stored as `ignored` (never trigger replies).

## Impact map
- New table + RLS (tenant-scoped read/update for members; inserts service-role only).
- `middleware.ts` public path. `workflows/tick`. Existing `instagram-webhook-handler.ts` NOT touched (different object/app product).

## Edge cases and failure modes
- Duplicate/out-of-order delivery → upsert. Bad signature → ignored. Unknown ig_user_id → ignored, logged.
- Deleted comment → webhook `remove`/404 on fetch → mark `deleted`, keep audit.
- Burst (viral post) → batch insert, no per-event fan-out in request path. Graph rate limit → retry with backoff in tick.
- Emoji/RTL/Tamil/very long text → stored as-is (truncate display only). Revoked token → account status revoked.

## Acceptance criteria
- Same event delivered 3× → one row. Tampered signature → no row.
- A comment, a mention and a DM each produce one correctly-typed row within 1 minute; a tag within 24 h or on manual refresh.
- Tenant A never sees tenant B's rows (RLS test).
