/**
 * Thin wrapper around the Anthropic Messages API, used only for the Instagram DM
 * AI-fallback reply. Plain `fetch` rather than the SDK, consistent with how the rest
 * of this codebase calls external APIs (see lib/meta.ts, lib/instagram.ts) — no new
 * dependency needed for one call site.
 *
 * Platform-level key (ANTHROPIC_API_KEY), shared across tenants, for v1. Never throws:
 * any failure (missing key, network error, timeout, malformed response) returns null so
 * the caller can no-op instead of the webhook ever failing because of the AI step.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/ai.ts is server-only and must not be imported in the browser.");
}

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 8000;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface ThreadMessage {
  direction: "inbound" | "outbound";
  body: string;
}

/**
 * Draft a reply given a system prompt (the tenant's configured persona/instructions)
 * and recent thread context. Returns null on any failure — caller must treat that as
 * "no automated reply this time", never surface an error to the DM sender.
 */
export async function draftReply(systemPrompt: string, thread: ThreadMessage[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const messages = thread
    .slice(-10)
    .map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: m.body }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      content?: Array<{ type?: string; text?: string }>;
    } | null;
    const text = json?.content?.find((c) => c.type === "text")?.text?.trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
