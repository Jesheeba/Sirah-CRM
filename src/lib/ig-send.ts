import { graphUrl, igJson } from "@/lib/ig-login";

/** Write Graph calls for the social desk (F4; Unified Login: graph.facebook.com). Each returns Instagram's id for what was posted. */

const url = (path: string, token: string) => {
  const u = graphUrl(path);
  u.searchParams.set("access_token", token);
  return u;
};
const idOf = (j: Record<string, unknown>) => String(j.id ?? j.message_id ?? "");

/** Public reply under a comment on the account's own media. */
export async function postCommentReply(commentId: string, text: string, token: string): Promise<string> {
  const u = url(`${commentId}/replies`, token);
  u.searchParams.set("message", text);
  return idOf(await igJson(u, { method: "POST" }));
}

/** Public reply to a comment that @mentioned the account (on someone else's media). */
export async function postMentionReply(igUserId: string, commentId: string, mediaId: string, text: string, token: string): Promise<string> {
  const u = url(`${igUserId}/mentions`, token);
  u.searchParams.set("comment_id", commentId);
  u.searchParams.set("media_id", mediaId);
  u.searchParams.set("message", text);
  return idOf(await igJson(u, { method: "POST" }));
}

async function sendMessage(igUserId: string, recipient: Record<string, string>, text: string, token: string): Promise<string> {
  return idOf(
    await igJson(url(`${igUserId}/messages`, token), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient, message: { text } }),
    }),
  );
}

/** Direct message to someone who messaged the account (24-hour window). */
export const sendDm = (igUserId: string, recipientId: string, text: string, token: string) =>
  sendMessage(igUserId, { id: recipientId }, text, token);

/** Private reply: a DM to the author of a comment (once per comment, within 7 days). */
export const sendPrivateReply = (igUserId: string, commentId: string, text: string, token: string) =>
  sendMessage(igUserId, { comment_id: commentId }, text, token);
