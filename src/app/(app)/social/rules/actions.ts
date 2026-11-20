"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowedChannels } from "@/lib/ig-reply";
import { fetchMedia, type IgPost } from "@/lib/ig-graph";
import { repliesFor, resolveIgRule, validateRule, type IgRule, type RuleInput } from "@/lib/ig-rules";

export interface RuleActionResult {
  ok: boolean;
  error?: string;
}

async function adminGuard() {
  const ctx = await getUserContext();
  if (!ctx?.tenantId) return { error: "Not authenticated." as const };
  if (!ctx.isAdmin) return { error: "Only admins can manage automatic replies." as const };
  return { ctx, admin: createAdminClient() };
}

/** Create or update a rule (admin only). Validated with the same function the tests cover. */
export async function saveIgRule(input: RuleInput & { id?: string }): Promise<RuleActionResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, error: g.error };
  const v = validateRule(input);
  if (!v.ok) return { ok: false, error: v.error };
  const { ctx, admin } = g;

  if (v.rule.ig_account_id) {
    const { data: acc } = await admin.from("ig_accounts").select("id").eq("id", v.rule.ig_account_id).eq("tenant_id", ctx.tenantId!).maybeSingle();
    if (!acc) return { ok: false, error: "That Instagram account isn't connected to your organization." };
  }
  const row = {
    tenant_id: ctx.tenantId,
    ig_account_id: v.rule.ig_account_id ?? null,
    name: v.rule.name,
    applies_to: v.rule.applies_to,
    ig_media_id: v.rule.ig_media_id,
    rule_type: v.rule.rule_type,
    match_keywords: v.rule.match_keywords,
    match_mode: v.rule.match_mode,
    whole_word: v.rule.whole_word,
    priority: v.rule.priority,
    is_enabled: v.rule.is_enabled ?? true,
    action: v.rule.action,
    reply_text: v.rule.reply_text,
    dm_text: v.rule.dm_text,
    send_mode: v.rule.send_mode,
  };
  const { error } = input.id
    ? await admin.from("ig_rules").update(row).eq("id", input.id).eq("tenant_id", ctx.tenantId!)
    : await admin.from("ig_rules").insert(row);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social/rules");
  return { ok: true };
}

export async function setIgRuleEnabled(id: string, enabled: boolean): Promise<RuleActionResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, error: g.error };
  const { error } = await g.admin.from("ig_rules").update({ is_enabled: enabled }).eq("id", id).eq("tenant_id", g.ctx.tenantId!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social/rules");
  return { ok: true };
}

export async function deleteIgRule(id: string): Promise<RuleActionResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, error: g.error };
  const { error } = await g.admin.from("ig_rules").delete().eq("id", id).eq("tenant_id", g.ctx.tenantId!);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social/rules");
  return { ok: true };
}

/** Blocklist, kill switch and caps for automatic replies. */
export async function saveAutomationSettings(input: {
  blocklist: string;
  autoPaused: boolean;
  hourlyCap: number;
  dailyCap: number;
}): Promise<RuleActionResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, error: g.error };
  const words = [...new Set(input.blocklist.split(/[\n,]/).map((w) => w.trim()).filter(Boolean))];
  if (words.length > 300 || words.some((w) => w.length > 60)) return { ok: false, error: "Blocklist: up to 300 words, 60 characters each." };
  const hourly = Math.round(Number(input.hourlyCap));
  const daily = Math.round(Number(input.dailyCap));
  if (!Number.isFinite(hourly) || hourly < 0 || hourly > 1000) return { ok: false, error: "Hourly limit must be 0–1000." };
  if (!Number.isFinite(daily) || daily < 0 || daily > 10000) return { ok: false, error: "Daily limit must be 0–10000." };

  const { error } = await g.admin.from("ig_desk_settings").upsert(
    { tenant_id: g.ctx.tenantId, blocklist: words, auto_paused: Boolean(input.autoPaused), auto_hourly_cap: hourly, auto_daily_cap: daily, updated_at: new Date().toISOString() },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/social/rules");
  return { ok: true };
}

export interface RuleTestResult {
  ok: boolean;
  error?: string;
  outcome?: "none" | "blocked" | "match";
  detail?: string;
  replies?: { channel: string; body: string }[];
  sendMode?: "auto" | "needs_approval";
}

/** "Test a comment": runs the live matcher on sample text. Sends nothing. */
export async function testIgRules(input: { kind: "comment" | "mention" | "dm"; text: string; mediaId?: string }): Promise<RuleTestResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, error: g.error };
  const [{ data: rules }, { data: s }] = await Promise.all([
    g.admin.from("ig_rules").select("*").eq("tenant_id", g.ctx.tenantId!).eq("is_enabled", true),
    g.admin.from("ig_desk_settings").select("blocklist, auto_paused").eq("tenant_id", g.ctx.tenantId!).maybeSingle(),
  ]);
  const settings = s as { blocklist?: string[]; auto_paused?: boolean } | null;
  const out = resolveIgRule(
    { kind: input.kind, text: input.text.slice(0, 2200), mediaId: input.mediaId?.trim() || null, igAccountId: "", isOwn: false },
    // The test isn't tied to one account, so account-specific rules are tried too.
    ((rules ?? []) as IgRule[]).map((r) => ({ ...r, ig_account_id: null })),
    settings?.blocklist ?? [],
  );
  if (out.kind === "none") return { ok: true, outcome: "none", detail: out.reason };
  if (out.kind === "blocked") return { ok: true, outcome: "blocked", detail: `Contains "${out.word}" from the blocklist — a person will handle it.` };
  const replies = repliesFor(out.rule, allowedChannels({ kind: input.kind, at: null, mediaId: input.mediaId || "post" }));
  const auto = out.rule.send_mode === "auto" && !settings?.auto_paused;
  return { ok: true, outcome: "match", detail: `Rule "${out.rule.name}" would fire.`, replies, sendMode: auto ? "auto" : "needs_approval" };
}

export interface PostListResult {
  ok: boolean;
  posts: (IgPost & { username: string | null })[];
  error?: string;
}

/** Recent posts of every connected account, newest first — for "Only on one post" in a rule (admin only). */
export async function listIgPosts(): Promise<PostListResult> {
  const g = await adminGuard();
  if (g.error) return { ok: false, posts: [], error: g.error };
  const { data: accounts } = await g.admin
    .from("ig_accounts")
    .select("ig_user_id, username, access_token")
    .eq("tenant_id", g.ctx.tenantId!)
    .eq("status", "active");
  if (!accounts?.length) return { ok: false, posts: [], error: "No Instagram account is connected." };
  const posts: PostListResult["posts"] = [];
  const errors: string[] = [];
  for (const a of accounts) {
    try {
      for (const p of await fetchMedia(a.ig_user_id as string, a.access_token as string)) posts.push({ ...p, username: (a.username as string | null) ?? null });
    } catch (e) {
      errors.push(`@${a.username ?? "account"}: ${e instanceof Error ? e.message : "could not load posts"}`);
    }
  }
  posts.sort((x, y) => (y.timestamp ?? "").localeCompare(x.timestamp ?? ""));
  return posts.length || !errors.length ? { ok: true, posts } : { ok: false, posts: [], error: errors.join("; ") };
}
