"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IntegrationChannel } from "@/lib/types";

export interface SaveIntegrationInput {
  channel: IntegrationChannel;
  is_enabled: boolean;
  // non-secret config
  from_email?: string | null;
  from_name?: string | null;
  phone_id?: string | null;
  business_account_id?: string | null;
  sms_sender_id?: string | null;
  api_endpoint?: string | null;
  // secret — blank/undefined leaves the stored value untouched
  secret?: string | null;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Upserts a tenant's integration config. Runs as the service role so it can write the
 * secret columns (which the anon/authenticated roles cannot). Admin-gated; the secret
 * is hashed down to a last-4 hint for display and is never returned to the caller.
 */
export async function saveIntegration(input: SaveIntegrationInput): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can change integrations." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();

  // Build the non-secret payload. tenant_id is set EXPLICITLY — the stamp trigger
  // can't infer it under the service role (no auth.uid()).
  const row: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    channel: input.channel,
    is_enabled: input.is_enabled,
    from_email: input.from_email?.trim() || null,
    from_name: input.from_name?.trim() || null,
    phone_id: input.phone_id?.trim() || null,
    business_account_id: input.business_account_id?.trim() || null,
    sms_sender_id: input.sms_sender_id?.trim() || null,
    api_endpoint: input.api_endpoint?.trim() || null,
  };

  // Only touch the secret when a new non-blank value is supplied.
  const secret = input.secret?.trim();
  if (secret) {
    const column = input.channel === "email" ? "api_key" : "access_token";
    row[column] = secret;
    row.secret_set = true;
    row.secret_last4 = secret.slice(-4);
  }

  const { error } = await admin
    .from("integration_settings")
    .upsert(row, { onConflict: "tenant_id,channel" });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Clears a channel's stored secret and disables it. Admin-gated, service role. */
export async function clearIntegrationSecret(
  channel: IntegrationChannel,
): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can change integrations." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();
  const column = channel === "email" ? "api_key" : "access_token";

  const { error } = await admin
    .from("integration_settings")
    .update({ [column]: null, secret_set: false, secret_last4: null, is_enabled: false })
    .eq("tenant_id", ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("channel", channel);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/integrations");
  return { ok: true };
}

/**
 * Returns the inbound webhook URL for the whatsapp_device channel.
 * The webhook_token is a secret — this server action reads it via service role and
 * returns only the fully-formed URL string (the token is embedded, not exposed separately).
 */
export async function getWhatsAppDeviceWebhookUrl(): Promise<string | null> {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin || !ctx.tenantId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("integration_settings")
    .select("webhook_token")
    .eq("tenant_id", ctx.tenantId)
    .eq("channel", "whatsapp_device")
    .maybeSingle();

  if (!data?.webhook_token) return null;

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/whatsapp/device/webhook/${data.webhook_token}`;
}

export interface SaveWhatsAppCloudInput {
  is_enabled: boolean;
  phone_id?: string | null;
  business_account_id?: string | null;
  // Secrets — only written when non-blank; blank/undefined leaves stored value untouched.
  access_token?: string | null;
  app_secret?: string | null;
  verify_token?: string | null;
}

/**
 * Saves all three WhatsApp Cloud API secrets in one upsert via the service role.
 * Separate from saveIntegration() because that action handles only one secret column.
 * Admin-gated; secrets are never returned to the caller.
 */
export async function saveWhatsAppCloudConfig(
  input: SaveWhatsAppCloudInput,
): Promise<SaveResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can change integrations." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();

  const row: Record<string, unknown> = {
    tenant_id: ctx.tenantId,
    channel: "whatsapp",
    is_enabled: input.is_enabled,
    phone_id: input.phone_id?.trim() || null,
    business_account_id: input.business_account_id?.trim() || null,
  };

  const accessToken = input.access_token?.trim();
  if (accessToken) {
    row.access_token = accessToken;
    row.secret_set = true;
    row.secret_last4 = accessToken.slice(-4);
  }

  const appSecret = input.app_secret?.trim();
  if (appSecret) {
    row.app_secret = appSecret;
    row.app_secret_set = true;
  }

  const verifyToken = input.verify_token?.trim();
  if (verifyToken) {
    row.verify_token = verifyToken;
  }

  const { error } = await admin
    .from("integration_settings")
    .upsert(row, { onConflict: "tenant_id,channel" });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** SMS scaffold — no live provider yet. */
export async function stubSendSms(): Promise<SaveResult> {
  return { ok: false, error: "SMS is not configured yet." };
}
