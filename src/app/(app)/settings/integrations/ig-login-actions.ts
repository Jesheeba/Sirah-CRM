"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unsubscribeIgAccount } from "@/lib/ig-login";

export interface IgLoginActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Disconnects an Instagram Login account: unsubscribes the webhooks (best effort), wipes the
 * stored token and marks the row `revoked`. History that references the account is kept.
 */
export async function disconnectIgAccount(igUserId: string): Promise<IgLoginActionResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can disconnect Instagram." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();
  const { data: acc } = await admin
    .from("ig_accounts")
    .select("id, access_token, ig_user_id")
    .eq("tenant_id", ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("ig_user_id", igUserId)
    .maybeSingle();
  if (!acc) return { ok: false, error: "Account not found." };

  if (acc.access_token) await unsubscribeIgAccount(acc.ig_user_id as string, acc.access_token as string).catch(() => {});
  const { error } = await admin
    .from("ig_accounts")
    .update({ status: "revoked", access_token: "", webhook_subscribed: false })
    .eq("id", acc.id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings/integrations");
  return { ok: true };
}
