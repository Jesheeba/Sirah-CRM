import { describe, it, expect } from "vitest";
import { resolveCommentAutomation, type InstagramCommentRule } from "@/lib/instagram-comment-automation";

function rule(overrides: Partial<InstagramCommentRule>): InstagramCommentRule {
  return {
    id: "r1",
    ig_media_id: null,
    rule_type: "keyword",
    priority: 100,
    is_enabled: true,
    match_keywords: [],
    action_type: "comment_reply",
    reply_text: null,
    dm_text: null,
    ...overrides,
  };
}

describe("resolveCommentAutomation", () => {
  it("does nothing for a comment authored by the page itself", () => {
    const action = resolveCommentAutomation({
      event: { text: "thanks!", mediaId: "m1", isFromPage: true },
      rules: [rule({ rule_type: "always", action_type: "comment_reply", reply_text: "Thanks for watching!" })],
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("matches an always rule scoped to the commented-on reel", () => {
    const action = resolveCommentAutomation({
      event: { text: "🔥🔥🔥", mediaId: "reel1", isFromPage: false },
      rules: [rule({ ig_media_id: "reel1", rule_type: "always", action_type: "private_reply", dm_text: "Thanks for the love! DM us PRICE for details." })],
    });
    expect(action).toEqual({ kind: "act", replyText: null, dmText: "Thanks for the love! DM us PRICE for details." });
  });

  it("ignores an always rule scoped to a different reel", () => {
    const action = resolveCommentAutomation({
      event: { text: "nice", mediaId: "reel2", isFromPage: false },
      rules: [rule({ ig_media_id: "reel1", rule_type: "always", action_type: "comment_reply", reply_text: "Thanks!" })],
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("prefers a media-specific rule over a page-wide wildcard rule regardless of priority", () => {
    const action = resolveCommentAutomation({
      event: { text: "price?", mediaId: "reel1", isFromPage: false },
      rules: [
        rule({ id: "wildcard", ig_media_id: null, priority: 1, rule_type: "keyword", match_keywords: ["price"], action_type: "comment_reply", reply_text: "wildcard reply" }),
        rule({ id: "scoped", ig_media_id: "reel1", priority: 100, rule_type: "keyword", match_keywords: ["price"], action_type: "comment_reply", reply_text: "scoped reply" }),
      ],
    });
    expect(action).toEqual({ kind: "act", replyText: "scoped reply", dmText: null });
  });

  it("returns both a comment reply and a DM for action_type 'both'", () => {
    const action = resolveCommentAutomation({
      event: { text: "how much?", mediaId: "reel1", isFromPage: false },
      rules: [rule({ rule_type: "keyword", match_keywords: ["how much"], action_type: "both", reply_text: "Check your DMs!", dm_text: "Here's our price list..." })],
    });
    expect(action).toEqual({ kind: "act", replyText: "Check your DMs!", dmText: "Here's our price list..." });
  });

  it("ignores disabled rules", () => {
    const action = resolveCommentAutomation({
      event: { text: "hello", mediaId: "m1", isFromPage: false },
      rules: [rule({ is_enabled: false, rule_type: "always", action_type: "comment_reply", reply_text: "hi" })],
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("does nothing when no rule matches", () => {
    const action = resolveCommentAutomation({
      event: { text: "random comment", mediaId: "m1", isFromPage: false },
      rules: [rule({ rule_type: "keyword", match_keywords: ["price"], action_type: "comment_reply", reply_text: "hi" })],
    });
    expect(action).toEqual({ kind: "none" });
  });
});
