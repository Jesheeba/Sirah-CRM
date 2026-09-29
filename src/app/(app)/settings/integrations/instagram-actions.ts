"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInstagramText } from "@/lib/instagram";
import type { InstagramRuleType, InstagramQuickReplyButton } from "@/lib/instagram-automation";
import type { InstagramCommentRuleType, InstagramCommentActionType } from "@/lib/instagram-comment-automation";

export interface InstagramActionResult {
  ok: boolean;
  error?: string;
}

/** Admin + tenant guard shared by every action below. */
async function requireAdminTenant() {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." as const };
  if (!ctx.isAdmin) return { error: "Only admins can manage Instagram DM automation." as const };
  if (!ctx.tenantId) return { error: "No organization found." as const };
  return { ctx };
}

/** Turn Instagram DM automation on/off for a connected Page. */
export async function setInstagramDmEnabled(pageId: string, enabled: boolean): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_lead_pages")
    .update({ ig_dm_enabled: enabled })
    .eq("tenant_id", g.ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Disconnect Instagram DM/comment automation for a Page, without touching its
 *  separate Facebook Lead Ads connection (same meta_lead_pages row can serve both). */
export async function disconnectInstagram(pageId: string): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  await admin
    .from("instagram_automation_rules")
    .delete()
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId);
  await admin
    .from("instagram_comment_rules")
    .delete()
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", pageId);

  const { error } = await admin
    .from("meta_lead_pages")
    .update({ ig_business_id: null, ig_dm_enabled: false, ig_comment_automation_enabled: false })
    .eq("tenant_id", g.ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

export interface InstagramRuleInput {
  id?: string;
  page_id: string;
  rule_type: InstagramRuleType;
  priority: number;
  is_enabled: boolean;
  match_keywords: string[];
  reply_text: string | null;
  reply_buttons: InstagramQuickReplyButton[] | null;
  payload: string | null;
  ai_system_prompt: string | null;
}

/** Create or update one automation rule for a page. */
export async function upsertInstagramRule(input: InstagramRuleInput): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  // Confirm the page belongs to this tenant before writing a rule against it —
  // service role bypasses RLS, so this check is the only thing stopping a rule
  // being attached to another tenant's page_id.
  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("page_id")
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", input.page_id)
    .maybeSingle();
  if (!page) return { ok: false, error: "Page not found." };

  const row = {
    tenant_id: g.ctx.tenantId,
    page_id: input.page_id,
    rule_type: input.rule_type,
    priority: input.priority,
    is_enabled: input.is_enabled,
    match_keywords: input.match_keywords,
    reply_text: input.reply_text,
    reply_buttons: input.reply_buttons,
    payload: input.payload,
    ai_system_prompt: input.ai_system_prompt,
  };

  const { error } = input.id
    ? await admin
        .from("instagram_automation_rules")
        .update(row)
        .eq("id", input.id)
        .eq("tenant_id", g.ctx.tenantId)
    : await admin.from("instagram_automation_rules").insert(row);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

export async function deleteInstagramRule(id: string): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("instagram_automation_rules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", g.ctx.tenantId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Turn Instagram comment automation on/off for a connected Page. */
export async function setInstagramCommentAutomationEnabled(pageId: string, enabled: boolean): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("meta_lead_pages")
    .update({ ig_comment_automation_enabled: enabled })
    .eq("tenant_id", g.ctx.tenantId) // MANDATORY: service role bypasses RLS.
    .eq("page_id", pageId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

export interface InstagramCommentRuleInput {
  id?: string;
  page_id: string;
  ig_media_id: string | null;
  rule_type: InstagramCommentRuleType;
  priority: number;
  is_enabled: boolean;
  match_keywords: string[];
  action_type: InstagramCommentActionType;
  reply_text: string | null;
  dm_text: string | null;
}

/** Create or update one comment-automation rule for a page. */
export async function upsertInstagramCommentRule(input: InstagramCommentRuleInput): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  // Confirm the page belongs to this tenant before writing a rule against it —
  // service role bypasses RLS, so this check is the only thing stopping a rule
  // being attached to another tenant's page_id.
  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("page_id")
    .eq("tenant_id", g.ctx.tenantId)
    .eq("page_id", input.page_id)
    .maybeSingle();
  if (!page) return { ok: false, error: "Page not found." };

  const row = {
    tenant_id: g.ctx.tenantId,
    page_id: input.page_id,
    ig_media_id: input.ig_media_id,
    rule_type: input.rule_type,
    priority: input.priority,
    is_enabled: input.is_enabled,
    match_keywords: input.match_keywords,
    action_type: input.action_type,
    reply_text: input.reply_text,
    dm_text: input.dm_text,
  };

  const { error } = input.id
    ? await admin
        .from("instagram_comment_rules")
        .update(row)
        .eq("id", input.id)
        .eq("tenant_id", g.ctx.tenantId)
    : await admin.from("instagram_comment_rules").insert(row);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

export async function deleteInstagramCommentRule(id: string): Promise<InstagramActionResult> {
  const g = await requireAdminTenant();
  if (g.error) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const { error } = await admin
    .from("instagram_comment_rules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", g.ctx.tenantId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { ok: true };
}

/** Flip a conversation between bot-automated and human-handled. Any tenant member
 *  (not just Admins) can do this — it's part of handling a conversation, same as
 *  replying to it, not a configuration change. */
export async function setInstagramConversationMode(
  conversationId: string,
  mode: "bot" | "human",
): Promise<InstagramActionResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("instagram_conversations")
    .update({ mode })
    .eq("id", conversationId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export interface SendInstagramResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends a manual Instagram DM reply for a contact and logs it — the composer branch
 * ConversationThread.tsx calls for channel="instagram", mirroring sendWhatsApp's shape.
 * Access tokens are service-role-only (column-privilege protected), so this reads and
 * sends via the admin client even though authorization is still gated by the caller's
 * own session/tenant membership above.
 */
export async function sendInstagramReply(contactId: string, body: string): Promise<SendInstagramResult> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!body.trim()) return { ok: false, error: "Message body is required." };

  const admin = createAdminClient();

  const { data: convo } = await admin
    .from("instagram_conversations")
    .select("id, page_id, ig_user_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!convo) return { ok: false, error: "No Instagram conversation found for this contact." };

  const { data: page } = await admin
    .from("meta_lead_pages")
    .select("access_token")
    .eq("tenant_id", ctx.tenantId)
    .eq("page_id", convo.page_id)
    .maybeSingle();
  if (!page?.access_token) return { ok: false, error: "Page is no longer connected." };

  const { data: row, error: insErr } = await admin
    .from("communications")
    .insert({
      tenant_id: ctx.tenantId,
      channel: "instagram",
      direction: "outbound",
      status: "queued",
      to_external_id: convo.ig_user_id,
      body,
      provider: "instagram",
      related_to_type: "contact",
      related_to_id: contactId,
      owner_id: ctx.userId,
    })
    .select("id")
    .single();
  if (insErr || !row) return { ok: false, error: insErr?.message ?? "Could not log message." };

  const result = await sendInstagramText(page.access_token as string, convo.ig_user_id as string, body);
  await admin
    .from("communications")
    .update({ status: result.ok ? "sent" : "failed", provider_message_id: result.providerMessageId ?? null })
    .eq("id", row.id);

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
