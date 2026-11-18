import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./fake-admin";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({ ctx: {} as Record<string, unknown>, state: { tables: {} as Rows }, send: { postCommentReply: vi.fn(), postMentionReply: vi.fn(), sendDm: vi.fn(), sendPrivateReply: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ig-send", () => h.send);

import { deleteIgRule, saveAutomationSettings, saveIgRule, setIgRuleEnabled, testIgRules } from "@/app/(app)/social/rules/actions";

const good = { name: "Office", ig_account_id: null, applies_to: "comment" as const, ig_media_id: null, rule_type: "keyword" as const, match_keywords: ["office"], match_mode: "any" as const, whole_word: true, priority: 10, action: "public_reply" as const, reply_text: "Main Rd", dm_text: null, send_mode: "auto" as const };

beforeEach(() => {
  Object.assign(h.ctx, { userId: "u", tenantId: "T", isAdmin: true, isManager: false });
  h.state.tables = {
    ig_rules: [{ id: "theirs", tenant_id: "X", name: "Theirs", is_enabled: true, applies_to: "comment", rule_type: "always", match_keywords: [], action: "public_reply", reply_text: "x", priority: 1 }],
    ig_accounts: [{ id: "accX", tenant_id: "X" }],
    ig_desk_settings: [],
  };
  Object.values(h.send).forEach((f) => f.mockReset());
});

describe("F9 rule management", () => {
  it("an admin saves a valid rule for their own organization", async () => {
    expect(await saveIgRule(good)).toEqual({ ok: true });
    expect(h.state.tables.ig_rules.find((r) => r.name === "Office")).toMatchObject({ tenant_id: "T", match_keywords: ["office"], send_mode: "auto" });
  });
  it("invalid rules are refused with a reason", async () => {
    expect((await saveIgRule({ ...good, match_keywords: [] })).ok).toBe(false);
  });
  it("managers and reps can't manage rules", async () => {
    Object.assign(h.ctx, { isAdmin: false, isManager: true });
    expect((await saveIgRule(good)).ok).toBe(false);
    expect((await saveAutomationSettings({ blocklist: "", autoPaused: true, hourlyCap: 1, dailyCap: 1 })).ok).toBe(false);
  });
  it("can't attach a rule to another organization's account, or touch its rules", async () => {
    expect((await saveIgRule({ ...good, ig_account_id: "accX" })).ok).toBe(false);
    await setIgRuleEnabled("theirs", false);
    await deleteIgRule("theirs");
    expect(h.state.tables.ig_rules.find((r) => r.id === "theirs")).toMatchObject({ is_enabled: true });
  });
  it("safety settings: blocklist split and de-duplicated; caps validated", async () => {
    expect((await saveAutomationSettings({ blocklist: "complaint\nbribe, complaint\n\n", autoPaused: true, hourlyCap: 5, dailyCap: 50 })).ok).toBe(true);
    expect(h.state.tables.ig_desk_settings[0]).toMatchObject({ blocklist: ["complaint", "bribe"], auto_paused: true, auto_hourly_cap: 5, auto_daily_cap: 50 });
    expect((await saveAutomationSettings({ blocklist: "", autoPaused: false, hourlyCap: -1, dailyCap: 5 })).ok).toBe(false);
  });
});

describe("F9 'Test a comment'", () => {
  beforeEach(async () => {
    await saveIgRule(good);
    await saveAutomationSettings({ blocklist: "bribe", autoPaused: false, hourlyCap: 30, dailyCap: 200 });
  });
  it("shows which rule fires and what it would send — and sends nothing", async () => {
    const r = await testIgRules({ kind: "comment", text: "where is the office" });
    expect(r).toMatchObject({ ok: true, outcome: "match", sendMode: "auto", replies: [{ channel: "public", body: "Main Rd" }] });
    expect(Object.values(h.send).reduce((n, f) => n + f.mock.calls.length, 0)).toBe(0);
  });
  it("reports blocklist hits and no-match, and ignores other organizations' rules", async () => {
    expect((await testIgRules({ kind: "comment", text: "bribe at the office" })).outcome).toBe("blocked");
    expect((await testIgRules({ kind: "comment", text: "nice photo" })).outcome).toBe("none"); // "Theirs" (always) belongs to X
  });
});
