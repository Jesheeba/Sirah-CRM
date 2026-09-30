import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendInstagramQuickReplies,
  sendInstagramText,
  sendInstagramImage,
  checkIsInstagramFollower,
  replyToComment,
  sendPrivateReply,
  type InstagramSendResult,
} from "@/lib/instagram";
import { draftReply } from "@/lib/ai";
import { resolveInstagramAutomation, type InstagramAutomationRule } from "@/lib/instagram-automation";
import { resolveCommentAutomation, type InstagramCommentRule } from "@/lib/instagram-comment-automation";

/**
 * Shared Instagram/Page webhook body processor — pulled out of a route.ts file because
 * Next.js route files may only export HTTP method handlers, and this needs to be
 * callable from two different routes. Meta only allows one callback URL per webhook
 * object; the Page object's URL was already claimed by /api/meta/leadgen before
 * `messages`/`feed` were ever turned on for it, so both `/api/meta/leadgen` and
 * `/api/meta/instagram-webhook` call processInstagramWebhookBody after verifying their
 * own signature, rather than either silently dropping the other's events.
 */

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
/** The `feed` field's shape on a classic Page (Facebook Login for Business, the model
 *  this app uses) — comment events on a linked Instagram account's posts/reels arrive
 *  this way. The Page object's subscribed_apps edge doesn't even recognize a plain
 *  `"comments"` field, so this is the only path for this integration model. */
interface FeedChangeValue {
  item?: string; // "comment" for a comment event
  verb?: string; // "add" for a new comment
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  message?: string;
  from?: { id?: string; name?: string };
}
interface CommentChange {
  field?: string;
  value?: CommentChangeValue | FeedChangeValue;
}
interface Entry {
  id?: string; // Instagram Business Account id (object: "instagram") or Page id (object: "page")
  messaging?: MessagingEvent[];
  changes?: CommentChange[];
}

export async function processInstagramWebhookBody(raw: string): Promise<void> {
  try {
    const body = JSON.parse(raw) as { object?: string; entry?: Entry[] };
    // "instagram" carries DM events (looked up by Instagram Business Account id).
    // "feed" comment events for a classically-linked account arrive under "page"
    // instead, keyed by Page id — both are handled in the same loop below.
    const isPageFeed = body.object === "page";
    if (body.object !== "instagram" && !isPageFeed) return;

    const admin = createAdminClient();

    for (const entry of body.entry ?? []) {
      const entryId = entry.id;
      if (!entryId) continue;
      const igBusinessId = entryId; // only meaningful when body.object === "instagram"

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
          .select(
            "id, rule_type, priority, is_enabled, match_keywords, reply_text, reply_buttons, payload, ai_system_prompt, require_follower, reply_image_url, reply_link_url, reply_link_title",
          )
          .eq("tenant_id", page.tenant_id)
          .eq("page_id", page.page_id);
        const rules = (rulesRows ?? []) as InstagramAutomationRule[];

        // Only spend a Graph API call on the follow-status lookup when some enabled,
        // non-AI rule actually gates on it.
        const needsFollowerCheck = rules.some((r) => r.is_enabled && r.require_follower && r.rule_type !== "ai_fallback");
        const isFollower = needsFollowerCheck ? await checkIsInstagramFollower(page.access_token, igsid) : null;

        const action = resolveInstagramAutomation({
          mode,
          event: { text, quickReplyPayload, isFollower },
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
            action.text, action.buttons, action.imageUrl, action.linkUrl, action.linkTitle,
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
        // Native "comments" field (rare in this app's classic-linkage model) vs. the
        // Page's "feed" field, whose comment-add events carry a different shape — see
        // FeedChangeValue above.
        const isFeed = change.field === "feed";
        const feedValue = isFeed ? (change.value as FeedChangeValue | undefined) : undefined;
        if (isFeed && (feedValue?.item !== "comment" || feedValue?.verb !== "add")) continue;
        if (!isFeed && change.field !== "comments") continue;

        const nativeValue = !isFeed ? (change.value as CommentChangeValue | undefined) : undefined;
        const commentId = isFeed ? feedValue?.comment_id : nativeValue?.id;
        const commenterId = isFeed ? feedValue?.from?.id : nativeValue?.from?.id;
        const commentText = isFeed ? (feedValue?.message ?? null) : (nativeValue?.text ?? null);
        const mediaId = isFeed ? (feedValue?.post_id ?? null) : (nativeValue?.media?.id ?? null);
        if (!commentId || !commenterId) continue;

        // 1. Idempotency — Meta retries on non-200.
        const { count } = await admin
          .from("instagram_processed_comments")
          .select("comment_id", { count: "exact", head: true })
          .eq("comment_id", commentId);
        if ((count ?? 0) > 0) continue;

        // 2. Resolve tenant + page. "feed" events are keyed by Page id (isFeed);
        //    native "comments" events are keyed by Instagram Business Account id.
        const { data: page } = await admin
          .from("meta_lead_pages")
          .select("tenant_id, page_id, access_token, default_owner_id, connected_by, ig_business_id, ig_comment_automation_enabled")
          .eq(isFeed ? "page_id" : "ig_business_id", isFeed ? entryId : igBusinessId)
          .maybeSingle();
        if (!page || !page.ig_comment_automation_enabled || !page.access_token) continue;

        // A reply from the page itself lands back through this same webhook — never
        // let the bot answer its own comment reply. Public replies post as the Page
        // itself (feed model) or as the Instagram account (native model).
        const isFromPage = commenterId === (isFeed ? page.page_id : page.ig_business_id);

        const { data: rulesRows } = await admin
          .from("instagram_comment_rules")
          .select("id, ig_media_id, rule_type, priority, is_enabled, match_keywords, action_type, reply_text, dm_text")
          .eq("tenant_id", page.tenant_id)
          .eq("page_id", page.page_id);
        const rules = (rulesRows ?? []) as InstagramCommentRule[];

        const action = resolveCommentAutomation({
          event: { text: commentText, mediaId, isFromPage },
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
    // swallow — callers always return 200 so Meta doesn't retry indefinitely
  }
}

/** Logs+sends one outbound Instagram message and updates its status. */
async function sendOne(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  igsid: string,
  ownerId: string | null,
  contactId: string | null,
  body: string,
  send: () => Promise<InstagramSendResult>,
) {
  const { data: row } = await admin
    .from("communications")
    .insert({
      tenant_id: tenantId,
      channel: "instagram",
      direction: "outbound",
      status: "queued",
      to_external_id: igsid,
      body,
      provider: "instagram",
      related_to_type: contactId ? "contact" : null,
      related_to_id: contactId,
      owner_id: ownerId,
    })
    .select("id")
    .single();
  if (!row) return;

  const result = await send();
  await admin
    .from("communications")
    .update({ status: result.ok ? "sent" : "failed", provider_message_id: result.providerMessageId ?? null })
    .eq("id", row.id);
}

/** Sends a rule's reply: an optional image as its own message (Instagram attachments
 *  carry no caption), then the text with any link appended as a labeled, clickable
 *  line — plain text auto-links URLs, so no extra API call or permission is needed. */
async function sendAndLog(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  igsid: string,
  pageToken: string,
  ownerId: string | null,
  contactId: string | null,
  text: string,
  buttons?: { title: string; payload: string }[],
  imageUrl?: string | null,
  linkUrl?: string | null,
  linkTitle?: string | null,
) {
  if (imageUrl) {
    await sendOne(admin, tenantId, igsid, ownerId, contactId, `[image] ${imageUrl}`, () =>
      sendInstagramImage(pageToken, igsid, imageUrl),
    );
  }

  const finalText = linkUrl ? `${text}${text ? "\n\n" : ""}${linkTitle ? `${linkTitle}: ` : ""}${linkUrl}` : text;
  if (!finalText) return;

  await sendOne(admin, tenantId, igsid, ownerId, contactId, finalText, () =>
    buttons && buttons.length
      ? sendInstagramQuickReplies(pageToken, igsid, finalText, buttons)
      : sendInstagramText(pageToken, igsid, finalText),
  );
}
