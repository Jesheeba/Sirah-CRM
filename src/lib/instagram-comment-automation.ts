/**
 * Pure resolver for Instagram comment automation — no network/DB calls, so it's testable
 * in isolation, mirroring instagram-automation.ts. Given an inbound comment, decides
 * whether to post a public reply, send the commenter a private-reply DM, or both.
 *
 * Rule scope: a rule with `ig_media_id` set only fires for comments on that post/reel;
 * a rule with `ig_media_id: null` fires for comments on any post/reel. Media-specific
 * rules are checked before wildcard rules regardless of priority, so "this reel only"
 * behavior always wins over a page-wide default.
 */

export type InstagramCommentRuleType = "keyword" | "always";
export type InstagramCommentActionType = "comment_reply" | "private_reply" | "both";

export interface InstagramCommentRule {
  id: string;
  ig_media_id: string | null;
  rule_type: InstagramCommentRuleType;
  priority: number;
  is_enabled: boolean;
  match_keywords: string[];
  action_type: InstagramCommentActionType;
  reply_text: string | null;
  dm_text: string | null;
}

export interface InstagramCommentEvent {
  text: string | null;
  mediaId: string | null;
  /** True when the comment was authored by the page itself — must never trigger a
   *  reply, or the bot could end up replying to its own comment reply forever. */
  isFromPage: boolean;
}

export type InstagramCommentAction =
  | { kind: "none" }
  | { kind: "act"; replyText: string | null; dmText: string | null };

export function resolveCommentAutomation(params: {
  event: InstagramCommentEvent;
  rules: InstagramCommentRule[];
}): InstagramCommentAction {
  const { event, rules } = params;
  if (event.isFromPage) return { kind: "none" };

  const text = (event.text ?? "").trim();
  const lowerText = text.toLowerCase();

  const enabled = rules
    .filter((r) => r.is_enabled)
    .filter((r) => r.ig_media_id === null || r.ig_media_id === event.mediaId)
    // Media-specific rules first, then by priority (lower runs first).
    .sort((a, b) => {
      const aScoped = a.ig_media_id !== null ? 0 : 1;
      const bScoped = b.ig_media_id !== null ? 0 : 1;
      if (aScoped !== bScoped) return aScoped - bScoped;
      return a.priority - b.priority;
    });

  const matched = enabled.find((r) => {
    if (r.rule_type === "always") return true;
    if (r.rule_type === "keyword" && text) {
      return r.match_keywords.some((k) => k && lowerText.includes(k.toLowerCase()));
    }
    return false;
  });
  if (!matched) return { kind: "none" };

  return {
    kind: "act",
    replyText: matched.action_type === "comment_reply" || matched.action_type === "both" ? matched.reply_text : null,
    dmText: matched.action_type === "private_reply" || matched.action_type === "both" ? matched.dm_text : null,
  };
}
