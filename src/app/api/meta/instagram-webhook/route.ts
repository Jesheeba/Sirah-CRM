import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaVerifyToken, verifyMetaSignature } from "@/lib/meta";
import { sendInstagramQuickReplies, sendInstagramText, replyToComment, sendPrivateReply } from "@/lib/instagram";
import { draftReply } from "@/lib/ai";
import {
  resolveInstagramAutomation,
  type InstagramAutomationRule,
} from "@/lib/instagram-automation";
import {
  resolveCommentAutomation,
  type InstagramCommentRule,
} from "@/lib/instagram-comment-automation";

/** Webhook verification handshake (Meta calls GET once on subscribe). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");
  if (mode === "subscribe" && token && token === metaVerifyToken()) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

interface MessagingEvent {
  sender?: { id?: string };
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
  };
}
interface CommentChangeValue {
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  parent_id?: string;
}
interface CommentChange {
  field?: string;
  value?: CommentChangeValue;
}
interface Entry {
  id?: string; // the Instagram Business Account id
  messaging?: MessagingEvent[];
  changes?: CommentChange[];
}

/**
 * Receives Instagram `messages` events. Verifies the signature, resolves the owning
 * tenant/page by Instagram Business Account id, logs the inbound message, then runs
 * automation synchronously (so a reply feels instant rather than waiting on a cron
 * tick) — mirrors the WhatsApp Cloud webhook's idempotency/lookup/insert pattern.
 * Always returns 200 so Meta doesn't retry indefinitely on our own logic errors.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ received: true });
  }

  try {
    const body = JSON.parse(raw) as { object?: string; entry?: Entry[] };
    if (body.object !== "instagram") return NextResponse.json({ received: true });

    const admin = createAdminClient();

    for (const entry of body.entry ?? []) {
      const igBusinessId = entry.id;
      if (!igBusinessId) continue;

      for (const evt of entry.messaging ?? []) {
        const igsid = evt.sender?.id;
        const mid = evt.message?.mid;
        // Echoes are our own outbound messages bounced back through the webhook —
        // skip them or the bot could end up replying to itself.
        if (!igsid || !mid || evt.message?.is_echo) continue;

        // 1. Idempotency — Meta retries on non-200.
        const { count } = await admin
          .from("communications")
          .select("id", { count: "exact", head: true })
          .eq("provider_message_id", mid)
          .eq("channel", "instagram");
        if ((count ?? 0) > 0) continue;

        // 2. Resolve tenant + page by Instagram Business Account id.
        const { data: page } = await admin
          .from("meta_lead_pages")
          .select("tenant_id, page_id, access_token, default_owner_id, connected_by, ig_dm_enabled")
          .eq("ig_business_id", igBusinessId)
          .maybeSingle();
        if (!page || !page.ig_dm_enabled) continue;

        const ownerId = (page.default_owner_id ?? page.connected_by) as string | null;
        const text = evt.message?.text ?? null;
        const quickReplyPayload = evt.message?.quick_reply?.payload ?? null;

        // 3. Find-or-create the conversation state row.
        const { data: existingConvo } = await admin
          .from("instagram_conversations")
          .select("id, contact_id, mode, last_ai_reply_at")
          .eq("tenant_id", page.tenant_id)
          .eq("page_id", page.page_id)
          .eq("ig_user_id", igsid)
          .maybeSingle();

        let convoId = existingConvo?.id ?? null;
        let contactId = existingConvo?.contact_id ?? null;
        const mode = (existingConvo?.mode as "bot" | "human" | undefined) ?? "bot";
        const lastAiReplyAt = existingConvo?.last_ai_reply_at ?? null;

        if (!contactId) {
          const { data: matchedContact } = await admin
            .from("contacts")
            .select("id")
            .eq("tenant_id", page.tenant_id)
            .eq("instagram_id", igsid)
            .is("deleted_at", null)
            .maybeSingle();

          if (matchedContact) {
            contactId = matchedContact.id;
          } else {
            const { data: newContact } = await admin
              .from("contacts")
              .insert({
                tenant_id: page.tenant_id,
                first_name: "Instagram",
                last_name: `User ${igsid.slice(-6)}`,
                instagram_id: igsid,
                source: "Instagram DM",
                owner_id: page.default_owner_id ?? null,
              })
              .select("id")
              .single();
            contactId = newContact?.id ?? null;
          }
        }

        if (!convoId) {
          const { data: newConvo } = await admin
            .from("instagram_conversations")
            .insert({
              tenant_id: page.tenant_id,
              page_id: page.page_id,
              ig_user_id: igsid,
              contact_id: contactId,
              mode: "bot",
              last_inbound_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          convoId = newConvo?.id ?? null;
        } else {
          await admin
            .from("instagram_conversations")
            .update({ last_inbound_at: new Date().toISOString(), contact_id: contactId })
            .eq("id", convoId);
        }

        // 4. Log the inbound message.
        if (ownerId) {
          await admin.from("communications").insert({
            tenant_id: page.tenant_id,
            channel: "instagram",
            direction: "inbound",
            status: "received",
            to_external_id: igsid,
            body: text ?? (quickReplyPayload ? `[quick reply: ${quickReplyPayload}]` : ""),
            provider: "instagram",
            provider_message_id: mid,
            related_to_type: contactId ? "contact" : null,
            related_to_id: contactId,
            owner_id: ownerId,
            is_read: false,
          });
        }

        // 5. Automation — skip entirely if we have no page token to reply with.
        if (!page.access_token) continue;

        const { data: rulesRows } = await admin
          .from("instagram_automation_rules")
          .select("id, rule_type, priority, is_enabled, match_keywords, reply_text, reply_buttons, payload, ai_system_prompt")
          .eq("tenant_id", page.tenant_id)
          .eq("page_id", page.page_id);
        const rules = (rulesRows ?? []) as InstagramAutomationRule[];

        const action = resolveInstagramAutomation({
          mode,
          event: { text, quickReplyPayload },
          rules,
          lastAiReplyAt,
        });

        if (action.kind === "handoff") {
          await admin.from("instagram_conversations").update({ mode: "human" }).eq("id", convoId);
          if (action.ackText) {
            await sendAndLog(admin, page.tenant_id, igsid, page.access_token, ownerId, contactId, action.ackText);
          }
        } else if (action.kind === "reply") {
          await sendAndLog(
            admin, page.tenant_id, igsid, page.access_token, ownerId, contactId,
            action.text, action.buttons,
          );
        } else if (action.kind === "ai") {
          const { data: recent } = await admin
            .from("communications")
            .select("direction, body")
            .eq("tenant_id", page.tenant_id)
            .eq("channel", "instagram")
            .eq("to_external_id", igsid)
            .order("created_at", { ascending: false })
            .limit(10);
          const thread = (recent ?? [])
            .reverse()
            .map((r) => ({ direction: r.direction as "inbound" | "outbound", body: r.body ?? "" }));
          const drafted = await draftReply(action.systemPrompt, thread);
          if (drafted) {
            await admin.from("instagram_conversations").update({ last_ai_reply_at: new Date().toISOString() }).eq("id", convoId);
            await sendAndLog(admin, page.tenant_id, igsid, page.access_token, ownerId, contactId, drafted);
          }
        }
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== "comments") continue;
        const value = change.value;
        const commentId = value?.id;
        const commenterId = value?.from?.id;
        if (!commentId || !commenterId) continue;

        // 1. Idempotency — Meta retries on non-200.
        const { count } = await admin
          .from("instagram_processed_comments")
          .select("comment_id", { count: "exact", head: true })
          .eq("comment_id", commentId);
        if ((count ?? 0) > 0) continue;

        // 2. Resolve tenant + page by Instagram Business Account id.
        const { data: page } = await admin
          .from("meta_lead_pages")
          .select("tenant_id, page_id, access_token, default_owner_id, connected_by, ig_business_id, ig_comment_automation_enabled")
          .eq("ig_business_id", igBusinessId)
          .maybeSingle();
        if (!page || !page.ig_comment_automation_enabled || !page.access_token) continue;

        // A reply from the page itself lands back through this same webhook — never
        // let the bot answer its own comment reply.
        const isFromPage = commenterId === page.ig_business_id;

        const { data: rulesRows } = await admin
          .from("instagram_comment_rules")
          .select("id, ig_media_id, rule_type, priority, is_enabled, match_keywords, action_type, reply_text, dm_text")
          .eq("tenant_id", page.tenant_id)
          .eq("page_id", page.page_id);
        const rules = (rulesRows ?? []) as InstagramCommentRule[];

        const action = resolveCommentAutomation({
          event: { text: value?.text ?? null, mediaId: value?.media?.id ?? null, isFromPage },
          rules,
        });

        if (action.kind === "act") {
          if (action.replyText) {
            await replyToComment(commentId, page.access_token, action.replyText);
          }
          if (action.dmText) {
            const ownerId = (page.default_owner_id ?? page.connected_by) as string | null;

            // Track this like any other DM conversation so subsequent keyword/handoff
            // rules and the conversation history apply to it.
            const { data: existingConvo } = await admin
              .from("instagram_conversations")
              .select("id, contact_id")
              .eq("tenant_id", page.tenant_id)
              .eq("page_id", page.page_id)
              .eq("ig_user_id", commenterId)
              .maybeSingle();

            let contactId = existingConvo?.contact_id ?? null;
            if (!contactId) {
              const { data: matchedContact } = await admin
                .from("contacts")
                .select("id")
                .eq("tenant_id", page.tenant_id)
                .eq("instagram_id", commenterId)
                .is("deleted_at", null)
                .maybeSingle();
              if (matchedContact) {
                contactId = matchedContact.id;
              } else {
                const { data: newContact } = await admin
                  .from("contacts")
                  .insert({
                    tenant_id: page.tenant_id,
                    first_name: "Instagram",
                    last_name: `User ${commenterId.slice(-6)}`,
                    instagram_id: commenterId,
                    source: "Instagram Comment",
                    owner_id: page.default_owner_id ?? null,
                  })
                  .select("id")
                  .single();
                contactId = newContact?.id ?? null;
              }
            }

            if (existingConvo) {
              await admin
                .from("instagram_conversations")
                .update({ last_inbound_at: new Date().toISOString(), contact_id: contactId })
                .eq("id", existingConvo.id);
            } else {
              await admin.from("instagram_conversations").insert({
                tenant_id: page.tenant_id,
                page_id: page.page_id,
                ig_user_id: commenterId,
                contact_id: contactId,
                mode: "bot",
                last_inbound_at: new Date().toISOString(),
              });
            }

            const { data: row } = await admin
              .from("communications")
              .insert({
                tenant_id: page.tenant_id,
                channel: "instagram",
                direction: "outbound",
                status: "queued",
                to_external_id: commenterId,
                body: action.dmText,
                provider: "instagram",
                related_to_type: contactId ? "contact" : null,
                related_to_id: contactId,
                owner_id: ownerId,
              })
              .select("id")
              .single();
            if (row) {
              const result = await sendPrivateReply(commentId, page.access_token, action.dmText);
              await admin
                .from("communications")
                .update({ status: result.ok ? "sent" : "failed", provider_message_id: result.providerMessageId ?? null })
                .eq("id", row.id);
            }
          }
        }

        await admin.from("instagram_processed_comments").insert({ comment_id: commentId, tenant_id: page.tenant_id });
      }
    }
  } catch {
    // swallow — always return 200 so Meta doesn't retry indefinitely
  }
  return NextResponse.json({ received: true });
}

async function sendAndLog(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  igsid: string,
  pageToken: string,
  ownerId: string | null,
  contactId: string | null,
  text: string,
  buttons?: { title: string; payload: string }[],
) {
  if (!text) return;
  const { data: row } = await admin
    .from("communications")
    .insert({
      tenant_id: tenantId,
      channel: "instagram",
      direction: "outbound",
      status: "queued",
      to_external_id: igsid,
      body: text,
      provider: "instagram",
      related_to_type: contactId ? "contact" : null,
      related_to_id: contactId,
      owner_id: ownerId,
    })
    .select("id")
    .single();
  if (!row) return;

  const result =
    buttons && buttons.length
      ? await sendInstagramQuickReplies(pageToken, igsid, text, buttons)
      : await sendInstagramText(pageToken, igsid, text);

  await admin
    .from("communications")
    .update({
      status: result.ok ? "sent" : "failed",
      provider_message_id: result.providerMessageId ?? null,
    })
    .eq("id", row.id);
}
