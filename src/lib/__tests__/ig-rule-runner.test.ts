import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeAdmin } from "./fake-admin";

const send = vi.hoisted(() => ({ postCommentReply: vi.fn(), postMentionReply: vi.fn(), sendDm: vi.fn(), sendPrivateReply: vi.fn() }));
vi.mock("@/lib/ig-send", () => send);

import { applyIgRules } from "@/lib/ig-rule-runner";
import type { CreatedInteraction } from "@/lib/ig-ingest";

type Rows = Record<string, Record<string, unknown>[]>;
let t: Rows;
const now = new Date();
const item = (over: Partial<CreatedInteraction> = {}): CreatedInteraction => ({
  id: "i1", tenant_id: "T", ig_account_id: "acc", kind: "comment", provider_id: "cmt-1", author_id: "u9",
  text: "where is the office?", media_id: "post-1", created_at_provider: now.toISOString(), received_at: now.toISOString(), ...over,
});
const addItem = (it: CreatedInteraction) => t.ig_interactions.push({ ...it, status: "new" });
const rule = (over: Record<string, unknown> = {}) => ({
  id: "rule-1", tenant_id: "T", name: "Office", ig_account_id: null, applies_to: "comment", ig_media_id: null, rule_type: "keyword",
  match_keywords: ["office"], match_mode: "any", whole_word: true, priority: 10, is_enabled: true, action: "public_reply",
  reply_text: "Main Road, 10–5", dm_text: null, send_mode: "auto", ...over,
});
const run = (items: CreatedInteraction[]) => applyIgRules(new FakeAdmin(t) as unknown as SupabaseClient, items, { now });
const sends = () => Object.values(send).reduce((n, f) => n + f.mock.calls.length, 0);

beforeEach(() => {
  Object.values(send).forEach((f) => f.mockReset().mockResolvedValue("ig-r"));
  t = {
    ig_accounts: [{ id: "acc", tenant_id: "T", ig_user_id: "ig-1", access_token: "tok", status: "active" }],
    ig_interactions: [],
    ig_rules: [rule()],
    ig_desk_settings: [],
    ig_replies: [],
    ig_reply_events: [],
  };
});

describe("F9 runner", () => {
  it("an auto rule posts the reply, marks the item replied and records why", async () => {
    addItem(item());
    expect(await run([item()])).toEqual({ matched: 1, sent: 1, queued: 0, blocked: 0 });
    expect(send.postCommentReply).toHaveBeenCalledWith("cmt-1", "Main Road, 10–5", "tok");
    expect(t.ig_replies[0]).toMatchObject({ source: "rule", rule_id: "rule-1", status: "sent", drafted_by: null });
    expect(t.ig_interactions[0].status).toBe("replied");
    expect(t.ig_reply_events.map((e) => e.action)).toEqual(["drafted", "approved", "sent"]);
  });
  it("a 'needs approval' rule only queues the reply", async () => {
    t.ig_rules = [rule({ send_mode: "needs_approval" })];
    addItem(item());
    expect(await run([item()])).toMatchObject({ queued: 1, sent: 0 });
    expect(sends()).toBe(0);
    expect(t.ig_replies[0].status).toBe("pending_approval");
  });
  it("a blocklist word never auto-sends", async () => {
    t.ig_desk_settings = [{ tenant_id: "T", blocklist: ["complaint"], auto_paused: false, auto_hourly_cap: 30, auto_daily_cap: 200 }];
    addItem(item({ text: "complaint about the office" }));
    expect(await run([item({ text: "complaint about the office" })])).toMatchObject({ blocked: 1, sent: 0, queued: 0 });
    expect(sends()).toBe(0);
    expect(t.ig_replies).toHaveLength(0);
  });
  it("the kill switch turns automatic replies into approval requests", async () => {
    t.ig_desk_settings = [{ tenant_id: "T", blocklist: [], auto_paused: true, auto_hourly_cap: 30, auto_daily_cap: 200 }];
    addItem(item());
    expect(await run([item()])).toMatchObject({ queued: 1, sent: 0 });
    expect(sends()).toBe(0);
  });
  it("the same item processed twice fires only once", async () => {
    addItem(item());
    await run([item()]);
    await run([item()]);
    expect(send.postCommentReply).toHaveBeenCalledTimes(1);
  });
  it("the hourly cap queues further replies instead of sending", async () => {
    t.ig_desk_settings = [{ tenant_id: "T", blocklist: [], auto_paused: false, auto_hourly_cap: 1, auto_daily_cap: 200 }];
    const a = item({ id: "a", provider_id: "c-a", author_id: "p1" });
    const b = item({ id: "b", provider_id: "c-b", author_id: "p2" });
    addItem(a);
    addItem(b);
    expect(await run([a, b])).toMatchObject({ sent: 1, queued: 1 });
  });
  it("the same person within 10 minutes gets a queued reply, not a second automatic one", async () => {
    const a = item({ id: "a", provider_id: "c-a" });
    const b = item({ id: "b", provider_id: "c-b" });
    addItem(a);
    addItem(b);
    expect(await run([a, b])).toMatchObject({ sent: 1, queued: 1 });
  });
  it("a DM rule answers by DM; tags are skipped; no rules means nothing happens", async () => {
    t.ig_rules = [rule({ id: "dm", applies_to: "dm", action: "dm_reply", dm_text: "Hi!", match_keywords: ["hello"] })];
    const dm = item({ id: "d", kind: "dm", provider_id: "mid", text: "hello" });
    addItem(dm);
    await run([dm, item({ id: "tg", kind: "tag", text: "hello" })]);
    expect(send.sendDm).toHaveBeenCalledWith("u9", "Hi!", "tok");
    t.ig_rules = [];
    expect(await run([item({ id: "z" })])).toEqual({ matched: 0, sent: 0, queued: 0, blocked: 0 });
  });
  it("a refused send is recorded as failed and the item stays open", async () => {
    send.postCommentReply.mockRejectedValueOnce(new Error("(#100) nope"));
    addItem(item());
    expect(await run([item()])).toMatchObject({ matched: 1, sent: 0 });
    expect(t.ig_replies[0].status).toBe("failed");
    expect(t.ig_interactions[0].status).toBe("new");
  });
  it("rules of another organization never fire", async () => {
    t.ig_rules = [rule({ tenant_id: "OTHER" })];
    addItem(item());
    expect((await run([item()])).matched).toBe(0);
  });
});
