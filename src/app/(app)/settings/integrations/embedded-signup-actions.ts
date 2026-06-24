"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ConnectWhatsAppInput {
  code: string;
  waba_id: string;
  phone_number_id: string;
}

export interface ConnectWhatsAppResult {
  ok: boolean;
  error?: string;
}

/**
 * Called after WhatsApp Embedded Signup completes.
 * Exchanges the one-time code for an access token, subscribes the WABA to
 * this app's webhook, registers the phone for Cloud API, then persists all
 * credentials for the tenant via the service-role admin client.
 *
 * The token is never returned to the client — only a success/error result.
 */
export async function connectWhatsAppEmbedded(
  input: ConnectWhatsAppInput,
): Promise<ConnectWhatsAppResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can connect WhatsApp." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const appId = process.env.NEXT_PUBLIC_FB_APP_ID;
  const appSecret = process.env.FB_APP_SECRET;

  if (!appId || !appSecret) {
    return {
      ok: false,
      error: "Facebook app credentials are not configured on this server (NEXT_PUBLIC_FB_APP_ID / FB_APP_SECRET).",
    };
  }

  // ── Step 1: Exchange the short-lived code for an access token ─────────────
  const tokenUrl = new URL("https://graph.facebook.com/v22.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("code", input.code);

  const tokenRes = await fetch(tokenUrl.toString());
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error?: { message?: string };
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    return {
      ok: false,
      error: tokenJson.error?.message ?? `Token exchange failed (${tokenRes.status}).`,
    };
  }

  const accessToken = tokenJson.access_token;

  // ── Step 2: Subscribe the WABA to this app's webhook (non-fatal) ──────────
  try {
    await fetch(`https://graph.facebook.com/v22.0/${input.waba_id}/subscribed_apps`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    // Network error — proceed; subscription may already exist.
  }

  // ── Step 3: Register the phone number for Cloud API sends (best-effort) ───
  // For Embedded Signup the phone may already be registered; errors are non-fatal.
  try {
    const pin = String(Math.floor(100000 + Math.random() * 900000));
    await fetch(`https://graph.facebook.com/v22.0/${input.phone_number_id}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    });
  } catch {
    // Non-fatal — phone may already be registered with another BSP.
  }

  // ── Step 4: Persist credentials for this tenant ───────────────────────────
  const admin = createAdminClient();
  const { error: dbErr } = await admin.from("integration_settings").upsert(
    {
      tenant_id: ctx.tenantId,
      channel: "whatsapp",
      is_enabled: true,
      phone_id: input.phone_number_id,
      business_account_id: input.waba_id,
      access_token: accessToken,
      secret_set: true,
      secret_last4: accessToken.slice(-4),
    },
    { onConflict: "tenant_id,channel" },
  );

  if (dbErr) return { ok: false, error: dbErr.message };

  revalidatePath("/settings/integrations");
  return { ok: true };
}
