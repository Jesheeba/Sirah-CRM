/**
 * Keyword rules for the Instagram social desk (F9). Pure: matching, rule validation and the
 * replies a matched rule produces. No network or DB, so the "Test a comment" box and the live
 * runner share exactly this logic.
 */
import type { ReplyChannel } from "@/lib/ig-reply";

export type RuleAppliesTo = "comment" | "mention" | "dm";
export type RuleAction = "public_reply" | "private_reply" | "both" | "dm_reply";

export interface IgRule {
  id: string;
  name: string;
  ig_account_id: string | null;
  applies_to: RuleAppliesTo;
  ig_media_id: string | null;
  rule_type: "keyword" | "always";
  match_keywords: string[];
  match_mode: "any" | "all";
  whole_word: boolean;
  priority: number;
  is_enabled: boolean;
  action: RuleAction;
  reply_text: string | null;
  dm_text: string | null;
  send_mode: "auto" | "needs_approval";
}

export interface RuleEvent {
  kind: "comment" | "mention" | "tag" | "dm";
  text: string | null;
  mediaId: string | null;
  igAccountId: string;
  /** Written by the connected account itself — never answered. */
  isOwn: boolean;
}

export type RuleOutcome =
  | { kind: "none"; reason: string }
  | { kind: "blocked"; word: string }
  | { kind: "match"; rule: IgRule };

/** Case-, width- and accent-form-insensitive comparison text. Scripts like Tamil are kept as written. */
export const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word match treats letters, combining marks (Tamil/Hindi vowel signs) and digits as word characters. */
export function containsKeyword(text: string, keyword: string, wholeWord: boolean): boolean {
  const t = normalize(text);
  const k = normalize(keyword.trim());
  if (!k) return false;
  if (!wholeWord) return t.includes(k);
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}_])${escape(k)}($|[^\\p{L}\\p{M}\\p{N}_])`, "u").test(t);
}

/** Blocklist words always send the item to a person, whatever the rules say. Substring match, on purpose. */
export function blockedWord(text: string, blocklist: string[]): string | null {
  const t = normalize(text);
  for (const w of blocklist) {
    const n = normalize(w.trim());
    if (n && t.includes(n)) return w.trim();
  }
  return null;
}

export function resolveIgRule(event: RuleEvent, rules: IgRule[], blocklist: string[]): RuleOutcome {
  if (event.isOwn) return { kind: "none", reason: "Written by your own account." };
  if (event.kind === "tag") return { kind: "none", reason: "Tagged posts can't be replied to." };
  const text = event.text ?? "";
  const hit = blockedWord(text, blocklist);
  if (hit) return { kind: "blocked", word: hit };

  const candidates = rules
    .filter((r) => r.is_enabled && r.applies_to === event.kind)
    .filter((r) => !r.ig_account_id || r.ig_account_id === event.igAccountId)
    .filter((r) => !r.ig_media_id || r.ig_media_id === event.mediaId)
    // Post-specific rules first, then priority (lower first), then name for a stable order.
    .sort((a, b) => Number(!!b.ig_media_id) - Number(!!a.ig_media_id) || a.priority - b.priority || a.name.localeCompare(b.name));

  for (const r of candidates) {
    if (r.rule_type === "always") return { kind: "match", rule: r };
    const kws = r.match_keywords.map((k) => k.trim()).filter(Boolean);
    if (!kws.length || !text.trim()) continue;
    const hits = kws.map((k) => containsKeyword(text, k, r.whole_word));
    if (r.match_mode === "all" ? hits.every(Boolean) : hits.some(Boolean)) return { kind: "match", rule: r };
  }
  return { kind: "none", reason: "No rule matched." };
}

/** The replies a matched rule produces, limited to what Instagram allows for this item. */
export function repliesFor(rule: IgRule, allowed: ReplyChannel[]): { channel: ReplyChannel; body: string }[] {
  const out: { channel: ReplyChannel; body: string }[] = [];
  const add = (channel: ReplyChannel, body: string | null) => {
    if (body?.trim() && allowed.includes(channel)) out.push({ channel, body: body.trim() });
  };
  if (rule.action === "public_reply" || rule.action === "both") add("public", rule.reply_text);
  if (rule.action === "private_reply" || rule.action === "both") add("private", rule.dm_text);
  if (rule.action === "dm_reply") add("dm", rule.dm_text);
  return out;
}

const ACTIONS_FOR: Record<RuleAppliesTo, RuleAction[]> = {
  comment: ["public_reply", "private_reply", "both"],
  mention: ["public_reply"],
  dm: ["dm_reply"],
};

export type RuleInput = Omit<IgRule, "id" | "is_enabled"> & { is_enabled?: boolean };

/** Checks a rule before saving and returns it cleaned (trimmed, de-duplicated keywords). */
export function validateRule(input: RuleInput): { ok: true; rule: RuleInput } | { ok: false; error: string } {
  const name = (input.name ?? "").trim();
  if (!name || name.length > 80) return { ok: false, error: "Give the rule a name (up to 80 characters)." };
  if (!(input.applies_to in ACTIONS_FOR)) return { ok: false, error: "Choose what the rule answers." };
  if (!ACTIONS_FOR[input.applies_to].includes(input.action)) return { ok: false, error: "That reply type isn't possible for this kind of item." };

  const seen = new Set<string>();
  const keywords = (input.match_keywords ?? [])
    .map((k) => k.trim())
    .filter((k) => k && !seen.has(normalize(k)) && seen.add(normalize(k)));
  if (input.rule_type === "keyword" && !keywords.length) return { ok: false, error: "Add at least one keyword." };
  if (keywords.length > 50 || keywords.some((k) => k.length > 60)) return { ok: false, error: "Up to 50 keywords, 60 characters each." };

  const needsPublic = input.action === "public_reply" || input.action === "both";
  const needsDm = input.action !== "public_reply";
  const reply_text = input.reply_text?.trim() || null;
  const dm_text = input.dm_text?.trim() || null;
  if (needsPublic && !reply_text) return { ok: false, error: "Write the public reply." };
  if (needsDm && !dm_text) return { ok: false, error: "Write the message text." };
  if (reply_text && [...reply_text].length > 2200) return { ok: false, error: "Public reply: up to 2200 characters." };
  if (dm_text && [...dm_text].length > 1000) return { ok: false, error: "Message: up to 1000 characters." };
  const priority = Number.isFinite(input.priority) ? Math.max(0, Math.min(10000, Math.round(input.priority))) : 100;

  return {
    ok: true,
    rule: {
      ...input,
      name,
      match_keywords: input.rule_type === "keyword" ? keywords : [],
      match_mode: input.match_mode === "all" ? "all" : "any",
      whole_word: input.whole_word !== false,
      priority,
      reply_text: needsPublic ? reply_text : null,
      dm_text: needsDm ? dm_text : null,
      ig_media_id: input.ig_media_id?.trim() || null,
      send_mode: input.send_mode === "auto" ? "auto" : "needs_approval",
    },
  };
}

/** `?media=` on the rules page: only Instagram's numeric media ids are accepted. */
export function mediaIdParam(v: unknown): string | null {
  return typeof v === "string" && /^\d{5,30}$/.test(v) ? v : null;
}
