import { GRAPH } from "./meta";

/**
 * Server-only helpers for sending Instagram DM replies via the Graph API's Send API.
 * Pure Graph calls only — no Supabase here, so both the webhook (service-role client,
 * automated replies) and the manual-reply server action (session client, a rep typing
 * a reply) can log the `communications` row their own way and just call these to
 * actually deliver the message, mirroring how sendViaCloudApi/sendViaDevice in
 * whatsapp/actions.ts keep the Graph call separate from the surrounding DB writes.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/instagram.ts is server-only and must not be imported in the browser.");
}

export interface InstagramSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface QuickReplyButton {
  title: string;
  payload: string;
}

async function callSendApi(pageToken: string, body: Record<string, unknown>): Promise<InstagramSendResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/me/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pageToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string };
  };
  if (!res.ok || json.error) {
    return { ok: false, error: json.error?.message ?? `Send failed (HTTP ${res.status}).` };
  }
  return { ok: true, providerMessageId: json.message_id };
}

/** Send a plain text DM reply. */
export async function sendInstagramText(pageToken: string, igsid: string, text: string): Promise<InstagramSendResult> {
  return callSendApi(pageToken, { recipient: { id: igsid }, message: { text } });
}

/** Send a text reply with up to 13 quick-reply buttons (Instagram's cap). */
export async function sendInstagramQuickReplies(
  pageToken: string,
  igsid: string,
  text: string,
  buttons: QuickReplyButton[],
): Promise<InstagramSendResult> {
  return callSendApi(pageToken, {
    recipient: { id: igsid },
    message: {
      text,
      quick_replies: buttons.slice(0, 13).map((b) => ({
        content_type: "text",
        title: b.title.slice(0, 20), // Instagram's quick-reply title cap
        payload: b.payload,
      })),
    },
  });
}

/** Post a public reply under a comment (on a post or reel). */
export async function replyToComment(commentId: string, pageToken: string, text: string): Promise<InstagramSendResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${commentId}/replies`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pageToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: text }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || json.error) {
    return { ok: false, error: json.error?.message ?? `Comment reply failed (HTTP ${res.status}).` };
  }
  return { ok: true, providerMessageId: json.id };
}

/** Send a "private reply" DM to whoever left a comment — Instagram's Send API accepts
 *  a `comment_id` recipient in place of the usual igsid, opening a DM thread from a
 *  comment without the commenter having messaged the page first. */
export async function sendPrivateReply(commentId: string, pageToken: string, text: string): Promise<InstagramSendResult> {
  return callSendApi(pageToken, { recipient: { comment_id: commentId }, message: { text } });
}
