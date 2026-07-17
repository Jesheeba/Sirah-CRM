# WhatsApp Embedded Signup — "Connect WhatsApp" tenant onboarding

> **Status:** 🟡 To build
> **Goal:** A tenant admin clicks one button, logs in with their own Facebook, connects their own WhatsApp number, and the CRM auto-saves their credentials per-tenant. No manual token/ID copying.
> **Stack:** Next.js 15 · TypeScript · Supabase · existing `integration_settings` + `/api/whatsapp/cloud/webhook`
> **Builds on:** existing Cloud API send/receive (already working)

---

## ⚠️ Read first — what this build can and cannot do

This spec builds the **code flow**. For it to work for *real external tenants*, Meta also requires (their clock, days/weeks — NOT code):
- **Tech Provider** status (app dashboard application)
- **App Review** approval (submit AFTER this flow is built, with a screen recording of it working)
- **Business Verification** of Sirah

**You CAN build + test this today** using your **own Facebook account** or a **Meta sandbox test account** (valid 30 days) — Meta returns a real `waba_id`, `phone_number_id`, and exchangeable code just like a real customer. So: build now, test in dev, submit for review after.

Use **Embedded Signup v4** (v2 is deprecated Oct 15 2026).

---

## Meta-side prerequisites (do once, in the dashboard — fill these values into env)

1. **Facebook Login for Business → Settings → Client OAuth settings:** add your domains (e.g. `https://sirah-crm-tfvi.vercel.app` + any custom domain) to **Allowed Domains** AND **Valid OAuth Redirect URIs**. HTTPS only.
2. **Facebook Login for Business → Configurations → Create from template →** "WhatsApp Embedded Signup Configuration With 60 Expiration Token". **Record the Configuration ID.**
3. Note your **Facebook App ID** (App Settings → Basic) and **App Secret** (already have it).
4. Env vars to set (Vercel + .env.local):
```
NEXT_PUBLIC_FB_APP_ID        = <your Facebook App ID>
NEXT_PUBLIC_FB_CONFIG_ID     = <the Configuration ID from step 2>
FB_APP_SECRET                = <your App Secret>   # server-only
```
*(These three are the only "fill in from Meta" values. The build below references them.)*

---

## How the flow works (the model)

```
Tenant clicks "Connect WhatsApp" in CRM settings
   → FB JS SDK opens Embedded Signup popup
   → tenant logs in with THEIR Facebook, picks/creates THEIR WhatsApp number
   → on finish, the popup returns to your page:
        (a) an exchangeable `code`         (via FB.login callback)
        (b) `waba_id` + `phone_number_id`  (via window 'message' event listener)
   → frontend POSTs {code, waba_id, phone_number_id} to your backend
   → backend: exchange code → access token → register the number → subscribe WABA to your webhook
            → save phone_id + waba_id + token into integration_settings for THIS tenant
   → done. Tenant connected, their number, their name.
```

---

## BUILD — what Claude Code should do

> First read existing code (do not duplicate): `src/lib/integrations.ts` (resolveWhatsAppConfig + how a tenant's `integration_settings` row is read/written), `src/app/(app)/settings/integrations/` (the WhatsApp Cloud card + saveWhatsAppCloudConfig action), `src/app/api/whatsapp/cloud/webhook/route.ts` (the webhook to subscribe numbers to), and how `ctx.tenantId` is resolved in server actions. Match all existing patterns (RLS, service-role writes, secret column privileges, tenant scoping).

### 1. Frontend — "Connect WhatsApp" button + Embedded Signup launcher
Add to the WhatsApp Cloud settings card (`IntegrationsClient.tsx` / WhatsAppCloudCard):
- Load the **Facebook JS SDK** once: `https://connect.facebook.net/en_US/sdk.js`, init with `FB.init({ appId: NEXT_PUBLIC_FB_APP_ID, version: 'v22.0', xfbml: false, cookie: true })`.
- A **"Connect WhatsApp" button** → `launchWhatsAppSignup()`:
```js
// message listener — captures waba_id + phone_number_id
function sessionInfoListener(event) {
  if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") return;
  try {
    const data = JSON.parse(event.data);
    if (data.type === "WA_EMBEDDED_SIGNUP" && (data.event === "FINISH" || data.event === "FINISH_ONLY_WABA")) {
      const { waba_id, phone_number_id } = data.data;
      window.__waSignup = { waba_id, phone_number_id }; // stash for the FB.login callback
    }
  } catch {}
}
window.addEventListener("message", sessionInfoListener);

function launchWhatsAppSignup() {
  FB.login(function (response) {
    if (response.authResponse && response.authResponse.code) {
      const code = response.authResponse.code;
      const { waba_id, phone_number_id } = window.__waSignup || {};
      // POST {code, waba_id, phone_number_id} to the backend connect endpoint (below)
    }
  }, {
    config_id: NEXT_PUBLIC_FB_CONFIG_ID,
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {}, featureType: "", sessionInfoVersion: 3 }
  });
}
```
- On success, call the new server action `connectWhatsAppEmbedded({ code, waba_id, phone_number_id })`, then show "Connected ✅" and refresh the card.

### 2. Backend — token exchange + onboarding (new server action / route)
`connectWhatsAppEmbedded(input)` — server-side, tenant-scoped via `ctx.tenantId`, service-role writes:

a. **Exchange the code for an access token:**
```
GET https://graph.facebook.com/v22.0/oauth/access_token
    ?client_id={FB_APP_ID}
    &client_secret={FB_APP_SECRET}
    &code={code}
```
→ returns `access_token` (this is the tenant's token).

b. **Subscribe the WABA to your app** (so inbound flows to your webhook):
```
POST https://graph.facebook.com/v22.0/{waba_id}/subscribed_apps
     Authorization: Bearer {access_token}
```

c. **Register the phone number for Cloud API** (required before sending):
```
POST https://graph.facebook.com/v22.0/{phone_number_id}/register
     Authorization: Bearer {access_token}
     body: { messaging_product: "whatsapp", pin: "<6-digit>" }   // generate/store a PIN
```

d. **Save to `integration_settings`** for this tenant (channel='whatsapp'), reusing the existing secret-column pattern:
- `phone_id = phone_number_id`
- `business_account_id = waba_id`
- `access_token = <exchanged token>` (SECRET)
- `is_enabled = true`
- mark `secret_set = true`
Upsert on (tenant_id, channel='whatsapp'). Then the existing send + webhook code works unchanged for this tenant.

e. Return `{ ok: true }` (or a clear error). Log failures with Meta's error message.

### 3. Middleware / config
- Ensure the FB SDK domain isn't blocked by CSP if you have one.
- No new webhook needed — reuse the existing `/api/whatsapp/cloud/webhook` (it already routes by `phone_number_id`).

### Files (expected)
| Action | File |
|---|---|
| Modify | `IntegrationsClient.tsx` / WhatsAppCloudCard — add SDK load + Connect button + launcher |
| Create | `src/app/(app)/settings/integrations/embedded-signup-actions.ts` — `connectWhatsAppEmbedded()` |
| Modify | env usage to read `NEXT_PUBLIC_FB_APP_ID`, `NEXT_PUBLIC_FB_CONFIG_ID`, `FB_APP_SECRET` |
| Reuse | existing `integration_settings`, webhook, send code (no changes) |

Pass `npx tsc --noEmit` clean. List any manual Meta steps + env vars at the end.

---

## Test plan (dev — no review needed)
1. Set the 3 env vars (App ID, Config ID, App Secret).
2. Open CRM settings → click **Connect WhatsApp**.
3. Complete the popup using your **own Facebook** or a **Meta sandbox test account**.
4. Confirm: `integration_settings` row for your tenant now has `phone_id`, `business_account_id`, `access_token`, `is_enabled=true` — all auto-filled (no manual copying).
5. Send a test from the CRM using the connected number.

---

## After it's built (Meta submissions — their clock)
1. Apply: **Become a Tech Provider**.
2. **Business Verification** (Sirah's documents).
3. **App Review** — submit with a screen recording of the Connect flow working.
4. On approval → real external tenants can self-connect.

> By default, even after approval, you can onboard up to ~10 new business customers per rolling 7-day window initially; this grows with usage.
