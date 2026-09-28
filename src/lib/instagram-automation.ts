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
}

export interface InstagramInboundEvent {
  text: string | null;
  /** Set when the sender tapped a quick-reply button, per Instagram's message shape
   *  (there is no separate Messenger-style "postback" event). */
  quickReplyPayload: string | null;
}

export type InstagramAutomationAction =
  | { kind: "none" }
  | { kind: "reply"; text: string; buttons?: InstagramQuickReplyButton[] }
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

  const enabled = rules.filter((r) => r.is_enabled).sort((a, b) => a.priority - b.priority);
  const text = (event.text ?? "").trim();
  const lowerText = text.toLowerCase();

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
      return { kind: "reply", text: byPayload.reply_text ?? "", buttons: byPayload.reply_buttons ?? undefined };
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
    return { kind: "reply", text: keywordRule.reply_text ?? "", buttons: keywordRule.reply_buttons ?? undefined };
  }

  // 4. Always (catch-all) — replies to any inbound text that didn't match a keyword,
  //    ahead of the AI fallback so a fixed reply is preferred when both are configured.
  const alwaysRule = enabled.find((r) => r.rule_type === "always");
  if (alwaysRule) {
    return { kind: "reply", text: alwaysRule.reply_text ?? "", buttons: alwaysRule.reply_buttons ?? undefined };
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
