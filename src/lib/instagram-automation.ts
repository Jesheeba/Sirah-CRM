/**
 * Pure resolver for Instagram DM automation — no network/DB calls, so it's testable in
 * isolation. Given the conversation's current mode and an inbound event, decides what
 * (if anything) should happen next. The webhook route is responsible for actually
 * sending replies and persisting any resulting state change (mode flip, last_ai_reply_at).
 *
 * Resolution order: human mode short-circuit → quick-reply payload (exact match) →
 * handoff keyword → keyword/menu rule → always (catch-all) → AI fallback (rate-limited) → no-op.
 */

export type InstagramRuleType = "keyword" | "menu" | "ai_fallback" | "handoff" | "always";

export interface InstagramQuickReplyButton {
  title: string;
  payload: string;
}

export interface InstagramAutomationRule {
  id: string;
  rule_type: InstagramRuleType;
  priority: number;
  is_enabled: boolean;
  match_keywords: string[];
  reply_text: string | null;
  reply_buttons: InstagramQuickReplyButton[] | null;
  payload: string | null;
  ai_system_prompt: string | null;
  /** Only fire this rule for senders who already follow the connected account (the
   *  common "follow me, then I'll DM you" pattern). Ignored by ai_fallback rules. */
  require_follower?: boolean;
  /** Optional image sent as its own message before/alongside the text reply. */
  reply_image_url?: string | null;
  /** Optional link appended to the text reply as a labeled, clickable line. */
  reply_link_url?: string | null;
  reply_link_title?: string | null;
}

export interface InstagramInboundEvent {
  text: string | null;
  /** Set when the sender tapped a quick-reply button, per Instagram's message shape
   *  (there is no separate Messenger-style "postback" event). */
  quickReplyPayload: string | null;
  /** Whether the sender follows the connected Instagram Business Account — omitted or
   *  null when unknown (e.g., lookup failed or wasn't needed because no rule requires
   *  it). Rules with require_follower are skipped unless this is exactly true. */
  isFollower?: boolean | null;
}

export type InstagramAutomationAction =
  | { kind: "none" }
  | {
      kind: "reply";
      text: string;
      buttons?: InstagramQuickReplyButton[];
      imageUrl?: string | null;
      linkUrl?: string | null;
      linkTitle?: string | null;
    }
  | { kind: "handoff"; ackText?: string }
  | { kind: "ai"; systemPrompt: string };

/** Minimum gap between AI-drafted replies in the same conversation, to bound spend
 *  from a chatty or adversarial sender on the shared platform API key. */
export const AI_FALLBACK_COOLDOWN_MS = 10_000;

export function resolveInstagramAutomation(params: {
  mode: "bot" | "human";
  event: InstagramInboundEvent;
  rules: InstagramAutomationRule[];
  lastAiReplyAt: string | null;
  now?: Date;
}): InstagramAutomationAction {
  const { mode, event, rules } = params;
  const now = params.now ?? new Date();

  if (mode === "human") return { kind: "none" };

  // A rule marked require_follower only fires when we've confirmed the sender follows
  // the account (isFollower === true) — unknown or false both skip it, never guess yes.
  const eligible = (r: InstagramAutomationRule) => !r.require_follower || event.isFollower === true;
  const enabled = rules.filter((r) => r.is_enabled && eligible(r)).sort((a, b) => a.priority - b.priority);
  const text = (event.text ?? "").trim();
  const lowerText = text.toLowerCase();
  const media = (r: InstagramAutomationRule) => ({
    imageUrl: r.reply_image_url ?? undefined,
    linkUrl: r.reply_link_url ?? undefined,
    linkTitle: r.reply_link_title ?? undefined,
  });

  // 1. Quick-reply tap — exact payload match against menu/handoff rules, checked
  //    before any keyword scan of the (often identical-looking) button title text.
  if (event.quickReplyPayload) {
    const byPayload = enabled.find(
      (r) => (r.rule_type === "menu" || r.rule_type === "handoff") && r.payload === event.quickReplyPayload,
    );
    if (byPayload) {
      if (byPayload.rule_type === "handoff") {
        return { kind: "handoff", ackText: byPayload.reply_text ?? undefined };
      }
      return {
        kind: "reply",
        text: byPayload.reply_text ?? "",
        buttons: byPayload.reply_buttons ?? undefined,
        ...media(byPayload),
      };
    }
  }

  if (!text) return { kind: "none" };

  // 2. Handoff keyword — "talk to a human", etc.
  const handoffRule = enabled.find(
    (r) =>
      r.rule_type === "handoff" &&
      r.match_keywords.some((k) => k && lowerText.includes(k.toLowerCase())),
  );
  if (handoffRule) return { kind: "handoff", ackText: handoffRule.reply_text ?? undefined };

  // 3. Keyword / menu rules triggered by typed text (menus can also open via keyword).
  const keywordRule = enabled.find(
    (r) =>
      (r.rule_type === "keyword" || r.rule_type === "menu") &&
      r.match_keywords.some((k) => k && lowerText.includes(k.toLowerCase())),
  );
  if (keywordRule) {
    return {
      kind: "reply",
      text: keywordRule.reply_text ?? "",
      buttons: keywordRule.reply_buttons ?? undefined,
      ...media(keywordRule),
    };
  }

  // 4. Always (catch-all) — replies to any inbound text that didn't match a keyword,
  //    ahead of the AI fallback so a fixed reply is preferred when both are configured.
  const alwaysRule = enabled.find((r) => r.rule_type === "always");
  if (alwaysRule) {
    return {
      kind: "reply",
      text: alwaysRule.reply_text ?? "",
      buttons: alwaysRule.reply_buttons ?? undefined,
      ...media(alwaysRule),
    };
  }

  // 5. AI fallback — only if nothing else matched, and only outside the cooldown.
  const aiRule = enabled.find((r) => r.rule_type === "ai_fallback" && r.ai_system_prompt);
  if (aiRule) {
    const last = params.lastAiReplyAt ? new Date(params.lastAiReplyAt).getTime() : 0;
    if (now.getTime() - last >= AI_FALLBACK_COOLDOWN_MS) {
      return { kind: "ai", systemPrompt: aiRule.ai_system_prompt! };
    }
  }

  return { kind: "none" };
}
