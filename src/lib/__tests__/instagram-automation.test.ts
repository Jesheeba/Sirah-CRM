import { describe, it, expect } from "vitest";
import { resolveInstagramAutomation, type InstagramAutomationRule } from "@/lib/instagram-automation";

function rule(overrides: Partial<InstagramAutomationRule>): InstagramAutomationRule {
  return {
    id: "r1",
    rule_type: "keyword",
    priority: 100,
    is_enabled: true,
    match_keywords: [],
    reply_text: null,
    reply_buttons: null,
    payload: null,
    ai_system_prompt: null,
    ...overrides,
  };
}

describe("resolveInstagramAutomation", () => {
  it("does nothing once a conversation is in human mode", () => {
    const action = resolveInstagramAutomation({
      mode: "human",
      event: { text: "hello", quickReplyPayload: null },
      rules: [rule({ rule_type: "keyword", match_keywords: ["hello"], reply_text: "hi" })],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("matches a quick-reply payload exactly before any keyword scan", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "Pricing", quickReplyPayload: "PRICING" },
      rules: [
        rule({ id: "menu1", rule_type: "menu", payload: "PRICING", reply_text: "Our prices are..." }),
        rule({ id: "kw1", rule_type: "keyword", match_keywords: ["pricing"], reply_text: "wrong match" }),
      ],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "reply", text: "Our prices are...", buttons: undefined });
  });

  it("flips to handoff mode on a handoff keyword and returns its ack text", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "I want to talk to a human please", quickReplyPayload: null },
      rules: [rule({ rule_type: "handoff", match_keywords: ["talk to a human"], reply_text: "Connecting you now." })],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "handoff", ackText: "Connecting you now." });
  });

  it("handoff keyword takes priority over a keyword rule", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "agent please, pricing question", quickReplyPayload: null },
      rules: [
        rule({ rule_type: "keyword", match_keywords: ["pricing"], reply_text: "Our prices..." }),
        rule({ rule_type: "handoff", match_keywords: ["agent"], reply_text: "One moment." }),
      ],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "handoff", ackText: "One moment." });
  });

  it("runs the lower-priority-number rule first when two keyword rules both match", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "what are your hours", quickReplyPayload: null },
      rules: [
        rule({ id: "runs-second", priority: 50, match_keywords: ["hours"], reply_text: "runs second" }),
        rule({ id: "runs-first", priority: 10, match_keywords: ["hours"], reply_text: "runs first" }),
      ],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "reply", text: "runs first", buttons: undefined });
  });

  it("falls back to AI when nothing else matches and the cooldown has elapsed", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "do you ship to Canada?", quickReplyPayload: null },
      rules: [rule({ rule_type: "ai_fallback", ai_system_prompt: "You are a helpful sales assistant." })],
      lastAiReplyAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(action).toEqual({ kind: "ai", systemPrompt: "You are a helpful sales assistant." });
  });

  it("suppresses the AI fallback inside the cooldown window", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "do you ship to Canada?", quickReplyPayload: null },
      rules: [rule({ rule_type: "ai_fallback", ai_system_prompt: "You are a helpful sales assistant." })],
      lastAiReplyAt: new Date(Date.now() - 2_000).toISOString(),
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("ignores disabled rules", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "hello", quickReplyPayload: null },
      rules: [rule({ is_enabled: false, match_keywords: ["hello"], reply_text: "hi" })],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("does nothing for an empty message with no quick-reply payload", () => {
    const action = resolveInstagramAutomation({
      mode: "bot",
      event: { text: "   ", quickReplyPayload: null },
      rules: [rule({ match_keywords: ["hello"], reply_text: "hi" })],
      lastAiReplyAt: null,
    });
    expect(action).toEqual({ kind: "none" });
  });
});
