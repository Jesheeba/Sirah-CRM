"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliver, isCaptionMention, loadContext, logEvent, settingsFor, windowFor, type Reply } from "@/lib/ig-reply-deliver";
import {
  allowedChannels,
  canApprove,
  initialStatus,
  validateBody,
  type ReplyChannel,
  type ReplyMode,
} from "@/lib/ig-reply";

export interface ReplyActionResult {
  ok: boolean;
  error?: string;
  status?: "pending_approval" | "sent" | "failed";
}

type Admin = ReturnType<typeof createAdminClient>;

/** Write a reply. In "human approval" mode it waits for an approver; in "direct" mode an Admin/Manager's reply posts at once. */
export async function submitReply(input: { interactionId: string; channel: ReplyChannel; body: string }): Promise<ReplyActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { ok: false, error: "Not authenticated." };
  const admin = createAdminClient();

  const loaded = await loadContext(admin, ctx.tenantId, input.interactionId);
  if (!loaded) return { ok: false, error: "Item not found." };
  const { it, acc } = loaded;

  const channels = allowedChannels({ kind: it.kind, at: it.created_at_provider, mediaId: it.media_id, captionMention: isCaptionMention(it) });
  if (!channels.includes(input.channel)) return { ok: false, error: "This item can't be answered that way." };
  const v = validateBody(input.body ?? "", input.channel);
  if (!v.ok) return { ok: false, error: v.reason };
  const win = await windowFor(admin, it, input.channel);
  if (!win.ok) return { ok: false, error: win.reason };

  const { mode } = await settingsFor(admin, ctx.tenantId);
  const actor = { userId: ctx.userId, isAdmin: ctx.isAdmin, isManager: ctx.isManager };
  const sendNow = initialStatus(mode, actor) === "send_now";

  const { data: created, error } = await admin
    .from("ig_replies")
    .insert({
      tenant_id: ctx.tenantId,
      interaction_id: it.id,
      channel: input.channel,
      body: v.body,
      source: "human",
      status: sendNow ? "approved" : "pending_approval",
      drafted_by: ctx.userId,
      approved_by: sendNow ? ctx.userId : null,
    })
    .select("id");
  const id = ((created ?? []) as { id: string }[])[0]?.id;
  if (error || !id) return { ok: false, error: error?.message ?? "Could not save the reply." };
  const reply: Reply = { id, tenant_id: ctx.tenantId, interaction_id: it.id, channel: input.channel, body: v.body, status: "approved", drafted_by: ctx.userId };
  await logEvent(admin, reply, ctx.userId, "drafted");

  revalidatePath(`/social/${it.id}`);
  revalidatePath("/social");
  if (!sendNow) return { ok: true, status: "pending_approval" };
  await logEvent(admin, reply, ctx.userId, "approved", "direct mode");
  return deliver(admin, reply, it, acc, ctx.userId);
}

async function loadReply(admin: Admin, tenantId: string, replyId: string) {
  const { data } = await admin
    .from("ig_replies")
    .select("id, tenant_id, interaction_id, channel, body, status, drafted_by")
    .eq("id", replyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as Reply | null) ?? null;
}

/** Approve a pending reply and post it. Claimed atomically, so a double click posts once. */
export async function approveReply(replyId: string): Promise<ReplyActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { ok: false, error: "Not authenticated." };
  const admin = createAdminClient();
  const reply = await loadReply(admin, ctx.tenantId, replyId);
  if (!reply) return { ok: false, error: "Reply not found." };
  if (reply.status !== "pending_approval") return { ok: false, error: "This reply was already handled." };

  const { allowSelf } = await settingsFor(admin, ctx.tenantId);
  const may = canApprove({ userId: ctx.userId, isAdmin: ctx.isAdmin, isManager: ctx.isManager }, reply.drafted_by, allowSelf);
  if (!may.ok) return { ok: false, error: may.reason };

  const { data: claimed } = await admin
    .from("ig_replies")
    .update({ status: "approved", approved_by: ctx.userId })
    .eq("id", reply.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending_approval")
    .select("id");
  if (!((claimed ?? []) as unknown[]).length) return { ok: false, error: "This reply was already handled." };
  await logEvent(admin, reply, ctx.userId, "approved");

  const loaded = await loadContext(admin, ctx.tenantId, reply.interaction_id);
  const res = loaded
    ? await deliver(admin, reply, loaded.it, loaded.acc, ctx.userId)
    : { ok: false, error: "The item no longer exists." };
  revalidatePath(`/social/${reply.interaction_id}`);
  revalidatePath("/social");
  return res;
}

/** Reject a pending reply. It is never sent. */
export async function rejectReply(replyId: string, note?: string): Promise<ReplyActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin && !ctx.isManager) return { ok: false, error: "Only admins and managers can reject replies." };
  const admin = createAdminClient();
  const reply = await loadReply(admin, ctx.tenantId, replyId);
  if (!reply) return { ok: false, error: "Reply not found." };
  const { data } = await admin
    .from("ig_replies")
    .update({ status: "rejected" })
    .eq("id", reply.id)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "pending_approval")
    .select("id");
  if (!((data ?? []) as unknown[]).length) return { ok: false, error: "This reply was already handled." };
  await logEvent(admin, reply, ctx.userId, "rejected", note?.slice(0, 300));
  revalidatePath(`/social/${reply.interaction_id}`);
  return { ok: true };
}

/** Put a failed reply back in the approval queue (e.g. after reconnecting the account). */
export async function retryReply(replyId: string): Promise<ReplyActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin && !ctx.isManager) return { ok: false, error: "Only admins and managers can retry replies." };
  const admin = createAdminClient();
  const reply = await loadReply(admin, ctx.tenantId, replyId);
  if (!reply || reply.status !== "failed") return { ok: false, error: "Only failed replies can be retried." };
  await admin.from("ig_replies").update({ status: "pending_approval", error: null, approved_by: null }).eq("id", reply.id).eq("tenant_id", ctx.tenantId);
  await logEvent(admin, reply, ctx.userId, "retried");
  revalidatePath(`/social/${reply.interaction_id}`);
  return { ok: true, status: "pending_approval" };
}

/** Admin setting: approval required (default) or direct posting. */
export async function setReplyMode(mode: ReplyMode, allowSelfApprove: boolean): Promise<ReplyActionResult> {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Only admins can change how replies are approved." };
  if (mode !== "human_approval" && mode !== "direct") return { ok: false, error: "Unknown mode." };
  const { error } = await createAdminClient()
    .from("ig_desk_settings")
    .upsert({ tenant_id: ctx.tenantId, reply_mode: mode, allow_self_approve: Boolean(allowSelfApprove), updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social");
  return { ok: true };
}
