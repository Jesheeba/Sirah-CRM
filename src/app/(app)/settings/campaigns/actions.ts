"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { CampaignAudience, EmailCampaign, RoutingCondition } from "@/lib/types";

const PATH = "/settings/campaigns";

async function adminCtx() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return null;
  return { admin: createAdminClient(), tenantId: ctx.tenantId! };
}

export interface CampaignInput {
  name: string;
  subject: string;
  body: string;
  audience: CampaignAudience;
  conditions: RoutingCondition[];
}

export async function createCampaign(
  data: CampaignInput,
): Promise<{ ok: boolean; error?: string; campaign?: EmailCampaign }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { data: campaign, error } = await ctx.admin
    .from("email_campaigns")
    .insert({
      tenant_id: ctx.tenantId,
      name: data.name.trim() || "Untitled campaign",
      subject: data.subject,
      body: data.body,
      audience: data.audience,
      conditions: data.conditions,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, campaign: campaign as EmailCampaign };
}

export async function updateCampaign(
  id: string,
  data: Partial<CampaignInput>,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { data: existing } = await ctx.admin.from("email_campaigns").select("status").eq("id", id).single();
  if (existing && existing.status !== "draft") {
    return { ok: false, error: "Only draft campaigns can be edited." };
  }

  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name.trim() || "Untitled campaign";
  if (data.subject !== undefined) updates.subject = data.subject;
  if (data.body !== undefined) updates.body = data.body;
  if (data.audience !== undefined) updates.audience = data.audience;
  if (data.conditions !== undefined) updates.conditions = data.conditions;

  const { error } = await ctx.admin.from("email_campaigns").update(updates).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteCampaign(id: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await adminCtx();
  if (!ctx) return { ok: false, error: "Admin access required" };

  const { error } = await ctx.admin.from("email_campaigns").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Materializes recipients and flips the campaign to 'sending' — the actual sends happen
 * in the daily cron (lib/campaign-runner.ts), same batching pattern as sequences/digests.
 * Uses the RLS-scoped client (not admin) since fn_resolve_campaign_recipients() runs as
 * the calling user by design, so RLS still gates who can trigger a send.
 */
export async function sendCampaign(id: string): Promise<{ ok: boolean; error?: string; recipientCount?: number }> {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) return { ok: false, error: "Admin access required" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fn_resolve_campaign_recipients", { p_campaign_id: id });
  if (error) return { ok: false, error: error.message };

  revalidatePath(PATH);
  return { ok: true, recipientCount: data as number };
}
