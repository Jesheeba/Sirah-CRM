import { graphUrl, igJson } from "@/lib/ig-login";
import type { IgEvent } from "@/lib/ig-webhook";

/** Read-side Graph calls for the social desk (Unified Login: graph.facebook.com; never put the token in errors). */

const base = graphUrl;
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export interface IgEnrichment {
  text: string | null;
  authorHandle: string | null;
  mediaId: string | null;
  permalink: string | null;
  occurredAt: string | null;
}

/** Text, author and post of an @mention. Comment mentions and caption mentions use different edges. */
export async function fetchMention(
  igUserId: string,
  mention: { commentId?: string; mediaId?: string },
  token: string,
): Promise<IgEnrichment | null> {
  const url = base(igUserId);
  url.searchParams.set("access_token", token);
  if (mention.commentId) {
    url.searchParams.set(
      "fields",
      `mentioned_comment.comment_id(${mention.commentId}){id,text,timestamp,username,media{id,permalink}}`,
    );
    const j = (await igJson(url)).mentioned_comment as Record<string, unknown> | undefined;
    if (!j) return null;
    const media = (j.media ?? {}) as Record<string, unknown>;
    return { text: str(j.text), authorHandle: str(j.username), mediaId: str(media.id), permalink: str(media.permalink), occurredAt: str(j.timestamp) };
  }
  if (mention.mediaId) {
    url.searchParams.set(
      "fields",
      `mentioned_media.media_id(${mention.mediaId}){id,caption,permalink,timestamp,username}`,
    );
    const j = (await igJson(url)).mentioned_media as Record<string, unknown> | undefined;
    if (!j) return null;
    return { text: str(j.caption), authorHandle: str(j.username), mediaId: str(j.id), permalink: str(j.permalink), occurredAt: str(j.timestamp) };
  }
  return null;
}

/** @username of a DM sender (messaging webhooks carry only the sender's IGSID). */
export async function fetchSenderHandle(igsid: string, token: string): Promise<string | null> {
  const url = base(igsid);
  url.searchParams.set("fields", "username");
  url.searchParams.set("access_token", token);
  return str((await igJson(url)).username);
}

export interface IgTaggedPost {
  id: string;
  username: string | null;
  caption: string | null;
  permalink: string | null;
  timestamp: string | null;
}

/** One page of posts that tag the account (Instagram sends no webhook for tags, so we poll). */
export async function fetchTags(igUserId: string, token: string, limit = 25): Promise<IgTaggedPost[]> {
  const url = base(`${igUserId}/tags`);
  url.searchParams.set("fields", "id,username,caption,permalink,timestamp");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", token);
  const j = await igJson(url);
  return ((j.data ?? []) as Record<string, unknown>[])
    .filter((p) => str(p.id))
    .map((p) => ({ id: str(p.id)!, username: str(p.username), caption: str(p.caption), permalink: str(p.permalink), timestamp: str(p.timestamp) }));
}

export type EnrichFn = (igUserId: string, mention: NonNullable<IgEvent["mention"]>, token: string) => Promise<IgEnrichment | null>;
