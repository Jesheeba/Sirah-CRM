# F1 — Instagram Login connect + token lifecycle

## Purpose
Connect an Instagram **professional account with no Facebook Page**; hold a working token.

## Architecture
- Start: `GET /api/ig/oauth/start` → redirect to `https://www.instagram.com/oauth/authorize`
  (scopes `instagram_business_basic,instagram_business_manage_comments,instagram_business_manage_messages`), signed `state` (tenant+user, expiry).
- Callback: exchange code → short token → **long-lived (60 d)** → `GET /me` (id, username, account_type).
  Reject personal accounts. Upsert `ig_accounts`.
- Table `ig_accounts`: tenant_id, ig_user_id (unique), username, access_token (service-role only), token_expires_at,
  scopes, status (active/expired/revoked), webhook_subscribed, connected_by, created_at.
- Subscribe: `POST /{ig-user-id}/subscribed_apps?subscribed_fields=comments,mentions,messages`.
- Refresh: daily job in `workflows/tick` refreshes tokens expiring within 10 days; on failure → status `expired` + notification.
- Disconnect: unsubscribe, delete token, keep history (tenant choice to purge).

## Impact map
- `middleware.ts` public prefixes (callback, webhook). `settings/integrations` page (new card). `workflows/tick` (refresh job).
- Existing `meta/oauth/*` and `meta_lead_pages` untouched. Privacy/terms pages (F8).

## Edge cases and failure modes
- User denies a scope → clear message, nothing saved. Personal account → rejected with reason.
- Same IG account connected to two tenants → blocked (unique ig_user_id).
- State tampering/expiry/replay → 400. Code reuse → error. Token refresh fails → status expired, tenant notified.
- Meta outage during exchange → no partial row.

## Acceptance criteria
- Connect works for a professional account and shows username; personal account is refused.
- Token stored only server-side; never returned to the browser or logged.
- Token refreshed before expiry (tested with a mocked clock); expired state visible in UI.
- Second tenant cannot attach the same account.
