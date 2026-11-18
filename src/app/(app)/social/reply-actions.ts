"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { postCommentReply, postMentionReply, sendDm, sendPrivateReply } from "@/lib/ig-send";
import {
  allowedChannels,
  canApprove,
  checkWindow,
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
interface Interaction {
  id: string;
  tenant_id: string;
  ig_account_id: string;
  kind: "comment" | "mention" | "tag" | "dm";
  provider_id: string;
  author_id: string | null;
  media_id: string | null;
  created_at_provider: string | null;
  received_at: string;
}
interface Account {
  id: string;
  ig_user_id: string;
  access_token: string;
  status: string;
}
interface Reply {
  id: string;
  tenant_id: string;
  interaction_id: string;
  channel: ReplyChannel;
  body: string;
  status: string;
  drafted_by: string | null;
}

async function settingsFor(admin: Admin, tenantId: string): Promise<{ mode: ReplyMode; allowSelf: boolean }> {
  const { data } = await admin.from("ig_desk_settings").select("reply_mode, allow_self_approve").eq("tenant_id", tenantId).maybeSingle();
  const s = data as { reply_mode?: ReplyMode; allow_self_approve?: boolean } | null;
  return { mode: s?.reply_mode ?? "human_approval", allowSelf: s?.allow_self_approve ?? false };
}

async function loadContext(admin: Admin, tenantId: string, interactionId: string) {
  const { data: it } = await admin
    .from("ig_interactions")
    .select("id, tenant_id, ig_account_id, kind, provider_id, author_id, media_id, created_at_provider, received_at")
    .eq("id", interactionId)
    .eq("tenant_id", tenantId) // MANDATORY: service role bypasses RLS.
    .maybeSingle();
  if (!it) return null;
  const { data: acc } = await admin
    .from("ig_accounts")
    .select("id, ig_user_id, access_token, status")
    .eq("id", (it as Interaction).ig_account_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return { it: it as Interaction, acc: (acc as Account | null) ?? null };
}

const isCaptionMention = (it: Interaction) => it.kind === "mention" && it.provider_id === it.media_id;

/** Instagram's window for this channel, measured at the moment of sending. */
async function windowFor(admin: Admin, it: Interaction, channel: ReplyChannel) {
  if (channel === "dm") {
    const { data } = await admin
      .from("ig_interactions")
      .select("received_at, created_at_provider")
      .eq("ig_account_id", it.ig_account_id)
      .eq("kind", "dm")
      .eq("author_id", it.author_id ?? "")
      .order("received_at", { ascending: false })
      .limit(1);
    const last = ((data ?? []) as { received_at: string; created_at_provider: string | null }[])[0];
    return checkWindow("dm", last ? last.created_at_provider ?? last.received_at : null);
  }
  if (channel === "private") {
    const { data } = await admin
      .from("ig_replies")
      .select("id")
      .eq("interaction_id", it.id)
      .eq("channel", "private")
      .eq("status", "sent");
    return checkWindow("private", it.created_at_provider ?? it.received_at, new Date(), ((data ?? []) as unknown[]).length > 0);
  }
  return checkWindow("public", null);
}

async function logEvent(admin: Admin, reply: Pick<Reply, "id" | "tenant_id">, actor: string | null, action: string, note?: string) {
  await admin.from("ig_reply_events").insert({ tenant_id: reply.tenant_id, reply_id: reply.id, actor, action, note: note ?? null });
}

/** Posts an approved reply. Never throws; records sent/failed on the reply and in the audit trail. */
async function deliver(admin: Admin, reply: Reply, it: Interaction, acc: Account | null, actor: string): Promise<ReplyActionResult> {
  const fail = async (message: string): Promise<ReplyActionResult> => {
    await admin.from("ig_replies").update({ status: "failed", error: message.slice(0, 500) }).eq("id", reply.id).eq("tenant_id", reply.tenant_id);
    await logEvent(admin, reply, actor, "failed", message.slice(0, 500));
    return { ok: false, status: "failed", error: message };
  };
  if (!acc || acc.status !== "active" || !acc.access_token) return fail("The Instagram account is disconnected or expired — reconnect it in Settings → Integrations.");
  const win = await windowFor(admin, it, reply.channel);
  if (!win.ok) return fail(win.reason);

  try {
    let providerId: string;
    if (reply.channel === "dm") providerId = await sendDm(it.author_id ?? "", reply.body, acc.access_token);
    else if (reply.channel === "private") providerId = await sendPrivateReply(it.provider_id, reply.body, acc.access_token);
    else if (it.kind === "mention") providerId = await postMentionReply(acc.ig_user_id, it.provider_id, it.media_id ?? "", reply.body, acc.access_token);
    else providerId = await postCommentReply(it.provider_id, reply.body, acc.access_token);

    await admin
      .from("ig_replies")
      .update({ status: "sent", sent_at: new Date().toISOString(), provider_reply_id: providerId || null, error: null })
      .eq("id", reply.id)
      .eq("tenant_id", reply.tenant_id);
    await admin.from("ig_interactions").update({ status: "replied" }).eq("id", it.id).eq("tenant_id", reply.tenant_id);
    await logEvent(admin, reply, actor, "sent");
    return { ok: true, status: "sent" };
  } catch (e) {
    return fail(`Instagram refused it: ${(e as Error).message}`);
  }
}

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
