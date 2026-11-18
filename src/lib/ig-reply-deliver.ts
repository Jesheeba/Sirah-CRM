import type { SupabaseClient } from "@supabase/supabase-js";
import { postCommentReply, postMentionReply, sendDm, sendPrivateReply } from "@/lib/ig-send";
import { checkWindow, type ReplyChannel, type ReplyMode } from "@/lib/ig-reply";

/**
 * The one guarded path that posts a reply to Instagram (F4, reused by keyword rules in F9):
 * re-checks the account and Instagram's window at send time, records sent/failed on the reply,
 * marks the item replied, and writes the audit trail. Never throws.
 */

export interface DeliverResult {
  ok: boolean;
  error?: string;
  status?: "pending_approval" | "sent" | "failed";
}

export type Admin = SupabaseClient;
export interface Interaction {
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
export interface Account {
  id: string;
  ig_user_id: string;
  access_token: string;
  status: string;
}
export interface Reply {
  id: string;
  tenant_id: string;
  interaction_id: string;
  channel: ReplyChannel;
  body: string;
  status: string;
  drafted_by: string | null;
}

export async function settingsFor(admin: Admin, tenantId: string): Promise<{ mode: ReplyMode; allowSelf: boolean }> {
  const { data } = await admin.from("ig_desk_settings").select("reply_mode, allow_self_approve").eq("tenant_id", tenantId).maybeSingle();
  const s = data as { reply_mode?: ReplyMode; allow_self_approve?: boolean } | null;
  return { mode: s?.reply_mode ?? "human_approval", allowSelf: s?.allow_self_approve ?? false };
}

export async function loadContext(admin: Admin, tenantId: string, interactionId: string) {
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

export const isCaptionMention = (it: Interaction) => it.kind === "mention" && it.provider_id === it.media_id;

/** Instagram's window for this channel, measured at the moment of sending. */
export async function windowFor(admin: Admin, it: Interaction, channel: ReplyChannel) {
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

export async function logEvent(admin: Admin, reply: Pick<Reply, "id" | "tenant_id">, actor: string | null, action: string, note?: string) {
  await admin.from("ig_reply_events").insert({ tenant_id: reply.tenant_id, reply_id: reply.id, actor, action, note: note ?? null });
}

/** Posts an approved reply. Never throws; records sent/failed on the reply and in the audit trail. */
export async function deliver(admin: Admin, reply: Reply, it: Interaction, acc: Account | null, actor: string | null): Promise<DeliverResult> {
  const fail = async (message: string): Promise<DeliverResult> => {
    await admin.from("ig_replies").update({ status: "failed", error: message.slice(0, 500) }).eq("id", reply.id).eq("tenant_id", reply.tenant_id);
    await logEvent(admin, reply, actor, "failed", message.slice(0, 500));
    return { ok: false, status: "failed", error: message };
  };
  if (!acc || acc.status !== "active" || !acc.access_token) return fail("The Instagram account is disconnected or expired — reconnect it in Settings → Integrations.");
  const win = await windowFor(admin, it, reply.channel);
  if (!win.ok) return fail(win.reason);

  try {
    let providerId: string;
    if (reply.channel === "dm") providerId = await sendDm(acc.ig_user_id, it.author_id ?? "", reply.body, acc.access_token);
    else if (reply.channel === "private") providerId = await sendPrivateReply(acc.ig_user_id, it.provider_id, reply.body, acc.access_token);
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

