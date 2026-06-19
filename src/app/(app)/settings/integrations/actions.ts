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

/** SMS scaffold — no live provider yet. */
export async function stubSendSms(): Promise<SaveResult> {
  return { ok: false, error: "SMS is not configured yet." };
}
