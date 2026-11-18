import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreatedInteraction } from "@/lib/ig-ingest";
import { allowedChannels } from "@/lib/ig-reply";
import { deliver, logEvent, type Account, type Reply } from "@/lib/ig-reply-deliver";
import { repliesFor, resolveIgRule, type IgRule } from "@/lib/ig-rules";

export interface RuleRunResult {
  matched: number;
  sent: number;
  queued: number;
  blocked: number;
}

interface DeskSettings {
  blocklist: string[];
  auto_paused: boolean;
  auto_hourly_cap: number;
  auto_daily_cap: number;
}

const AUTHOR_COOLDOWN_MS = 10 * 60_000;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Applies keyword rules to items that just arrived (F9). Deterministic and conservative:
 *  - blocklist words, the kill switch, the hourly/daily caps and a per-person cooldown all route
 *    to a person (queued for approval) instead of auto-posting;
 *  - at most one rule fires per item, and an item that already has a rule reply is skipped;
 *  - every reply goes through the same guarded `deliver` path as a person's approved reply.
 */
export async function applyIgRules(
  admin: SupabaseClient,
  created: CreatedInteraction[],
  deps: { now?: Date } = {},
): Promise<RuleRunResult> {
  const now = deps.now ?? new Date();
  const out: RuleRunResult = { matched: 0, sent: 0, queued: 0, blocked: 0 };
  const settingsCache = new Map<string, DeskSettings>();
  const rulesCache = new Map<string, IgRule[]>();
  const accountCache = new Map<string, Account | null>();

  for (const it of created) {
    if (it.kind === "tag") continue;

    if (!rulesCache.has(it.tenant_id)) {
      const [{ data: rules }, { data: s }] = await Promise.all([
        admin.from("ig_rules").select("*").eq("tenant_id", it.tenant_id).eq("is_enabled", true),
        admin.from("ig_desk_settings").select("blocklist, auto_paused, auto_hourly_cap, auto_daily_cap").eq("tenant_id", it.tenant_id).maybeSingle(),
      ]);
      rulesCache.set(it.tenant_id, (rules ?? []) as IgRule[]);
      const ds = s as Partial<DeskSettings> | null;
      settingsCache.set(it.tenant_id, {
        blocklist: ds?.blocklist ?? [],
        auto_paused: ds?.auto_paused ?? false,
        auto_hourly_cap: ds?.auto_hourly_cap ?? 30,
        auto_daily_cap: ds?.auto_daily_cap ?? 200,
      });
    }
    const rules = rulesCache.get(it.tenant_id)!;
    const settings = settingsCache.get(it.tenant_id)!;
    if (!rules.length) continue;

    const outcome = resolveIgRule(
      { kind: it.kind, text: it.text, mediaId: it.media_id, igAccountId: it.ig_account_id, isOwn: false },
      rules,
      settings.blocklist,
    );
    if (outcome.kind === "blocked") {
      out.blocked++;
      continue;
    }
    if (outcome.kind !== "match") continue;
    const rule = outcome.rule;

    // One rule reply per item, ever.
    const { data: prior } = await admin.from("ig_replies").select("id").eq("interaction_id", it.id).eq("source", "rule");
    if (((prior ?? []) as unknown[]).length) continue;

    const planned = repliesFor(
      rule,
      allowedChannels({ kind: it.kind, at: it.created_at_provider, mediaId: it.media_id, captionMention: it.kind === "mention" && it.provider_id === it.media_id }),
    );
    if (!planned.length) continue;
    out.matched++;

    const auto = rule.send_mode === "auto" && !settings.auto_paused && (await underCaps(admin, it, settings, now));

    if (!accountCache.has(it.ig_account_id)) {
      const { data: acc } = await admin
        .from("ig_accounts")
        .select("id, ig_user_id, access_token, status")
        .eq("id", it.ig_account_id)
        .eq("tenant_id", it.tenant_id)
        .maybeSingle();
      accountCache.set(it.ig_account_id, (acc as Account | null) ?? null);
    }

    for (const p of planned) {
      const { data: ins } = await admin
        .from("ig_replies")
        .insert({
          tenant_id: it.tenant_id,
          interaction_id: it.id,
          channel: p.channel,
          body: p.body,
          source: "rule",
          rule_id: rule.id,
          status: auto ? "approved" : "pending_approval",
          drafted_by: null,
        })
        .select("id");
      const id = ((ins ?? []) as { id: string }[])[0]?.id;
      if (!id) continue;
      const reply: Reply = { id, tenant_id: it.tenant_id, interaction_id: it.id, channel: p.channel, body: p.body, status: auto ? "approved" : "pending_approval", drafted_by: null };
      await logEvent(admin, reply, null, "drafted", `rule: ${rule.name}`);
      if (!auto) {
        out.queued++;
        continue;
      }
      await logEvent(admin, reply, null, "approved", "automatic (rule)");
      const r = await deliver(admin, reply, it, accountCache.get(it.ig_account_id) ?? null, null);
      if (r.ok) out.sent++;
    }
  }
  return out;
}

/** Caps and the per-person cooldown: when exceeded, the rule's reply waits for a person instead. */
async function underCaps(admin: SupabaseClient, it: CreatedInteraction, s: DeskSettings, now: Date): Promise<boolean> {
  const { data } = await admin
    .from("ig_replies")
    .select("sent_at, interaction_id")
    .eq("tenant_id", it.tenant_id)
    .eq("source", "rule")
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(Math.max(s.auto_daily_cap, 1) + 1);
  const sent = ((data ?? []) as { sent_at: string | null; interaction_id: string }[]).filter((r) => r.sent_at);
  const age = (r: { sent_at: string | null }) => now.getTime() - Date.parse(r.sent_at!);
  if (sent.filter((r) => age(r) < HOUR).length >= s.auto_hourly_cap) return false;
  if (sent.filter((r) => age(r) < DAY).length >= s.auto_daily_cap) return false;

  if (it.author_id) {
    const recentIds = sent.filter((r) => age(r) < AUTHOR_COOLDOWN_MS).map((r) => r.interaction_id);
    if (recentIds.length) {
      const { data: same } = await admin
        .from("ig_interactions")
        .select("id")
        .in("id", recentIds)
        .eq("author_id", it.author_id);
      if (((same ?? []) as unknown[]).length) return false;
    }
  }
  return true;
}
