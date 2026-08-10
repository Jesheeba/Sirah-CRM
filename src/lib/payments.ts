import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Resolves which Razorpay credentials to use for a tenant, mirroring the graceful-
 * degradation pattern in lib/integrations.ts:
 *   1. "tenant" — tenant configured their own Razorpay account under Settings → Integrations.
 *   2. "env"    — no tenant config, but deployment-wide env vars are present (single shared account).
 *   3. "none"   — neither configured; payment collection is unavailable for this tenant.
 *
 * key_secret / webhook_secret are read via the service-role client — those columns are
 * unreadable by the anon/authenticated roles. Every query is manually scoped to the tenant.
 */
export type RazorpayMode = "tenant" | "env" | "none";

export interface RazorpayConfig {
  mode: RazorpayMode;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
}

export async function resolveRazorpayConfig(tenantId: string | null): Promise<RazorpayConfig> {
  if (tenantId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integration_settings")
      .select("is_enabled, razorpay_key_id, access_token, webhook_secret")
      .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
      .eq("channel", "razorpay")
      .maybeSingle();

    if (data?.is_enabled && data.razorpay_key_id && data.access_token) {
      return {
        mode: "tenant",
        keyId: data.razorpay_key_id,
        keySecret: data.access_token,
        webhookSecret: data.webhook_secret,
      };
    }
  }

  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return {
      mode: "env",
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? null,
    };
  }

  return { mode: "none", keyId: null, keySecret: null, webhookSecret: null };
}

/** Basic-auth header value for Razorpay's REST API (key_id:key_secret, base64). */
export function razorpayAuthHeader(keyId: string, keySecret: string): string {
  return "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
}
