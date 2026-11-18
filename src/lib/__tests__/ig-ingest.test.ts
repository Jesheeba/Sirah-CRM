import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeAdmin } from "./fake-admin";
import { ingestIgEvents, pollIgTags } from "@/lib/ig-ingest";
import { parseIgWebhook, type IgEvent } from "@/lib/ig-webhook";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({ state: { tables: {} as Rows } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
import { GET, POST } from "@/app/api/ig/webhook/route";

const asClient = (t: Rows) => new FakeAdmin(t) as unknown as SupabaseClient;
const ev = (over: Partial<IgEvent> = {}): IgEvent => ({
  igUserId: "ig-A", kind: "comment", providerId: "c1", authorId: "u9", authorHandle: "citizen", text: "hi",
  mediaId: "m1", permalink: null, parentId: null, occurredAt: "2026-11-18T00:00:00.000Z", raw: {}, ...over,
});
const seed = (): Rows => ({
  ig_accounts: [
    { id: "acc-A", tenant_id: "tenant-A", ig_user_id: "ig-A", access_token: "tokA", status: "active" },
    { id: "acc-B", tenant_id: "tenant-B", ig_user_id: "ig-B", access_token: "tokB", status: "active" },
    { id: "acc-R", tenant_id: "tenant-C", ig_user_id: "ig-R", access_token: "", status: "revoked" },
  ],
  ig_interactions: [],
});

describe("F2 ingest", () => {
  let t: Rows;
  beforeEach(() => { t = seed(); });

  it("stores a comment, a mention and a tag with the right kind and tenant", async () => {
    const enrich = vi.fn().mockResolvedValue({ text: "@mla thanks!", authorHandle: "fan", mediaId: "mm", permalink: "https://ig/p/1", occurredAt: null });
    const r = await ingestIgEvents(asClient(t), [
      ev(),
      ev({ kind: "mention", providerId: "mc1", authorId: null, authorHandle: null, text: null, mention: { commentId: "mc1" } }),
      ev({ kind: "tag", providerId: "tg1", authorId: null, text: "tagged you" }),
    ], { enrich });
    expect(r).toMatchObject({ stored: 3, duplicate: 0 });
    expect(t.ig_interactions.map((x) => [x.kind, x.tenant_id, x.status])).toEqual([
      ["comment", "tenant-A", "new"], ["mention", "tenant-A", "new"], ["tag", "tenant-A", "new"],
    ]);
    expect(t.ig_interactions[1]).toMatchObject({ text: "@mla thanks!", author_handle: "fan", permalink: "https://ig/p/1" });
    expect(enrich).toHaveBeenCalledWith("ig-A", { commentId: "mc1" }, "tokA");
  });

  it("the same event delivered 3 times makes exactly one row", async () => {
    const client = asClient(t);
    for (let i = 0; i < 3; i++) await ingestIgEvents(client, [ev()]);
    expect(t.ig_interactions).toHaveLength(1);
  });
  it("duplicates inside a single delivery make one row", async () => {
    const r = await ingestIgEvents(asClient(t), [ev(), ev()]);
    expect(t.ig_interactions).toHaveLength(1);
    expect(r).toMatchObject({ stored: 1, duplicate: 1 });
  });
  it("the same provider id on two different accounts is two rows (scoped per account)", async () => {
    await ingestIgEvents(asClient(t), [ev(), ev({ igUserId: "ig-B" })]);
    expect(t.ig_interactions.map((x) => x.tenant_id).sort()).toEqual(["tenant-A", "tenant-B"]);
  });

  it("tenant isolation: each event is stored under its own account's tenant only", async () => {
    await ingestIgEvents(asClient(t), [ev({ igUserId: "ig-A", providerId: "a" }), ev({ igUserId: "ig-B", providerId: "b" })]);
    expect(t.ig_interactions.find((x) => x.provider_id === "a")?.tenant_id).toBe("tenant-A");
    expect(t.ig_interactions.find((x) => x.provider_id === "b")?.tenant_id).toBe("tenant-B");
  });
  it("drops events for unknown or revoked accounts", async () => {
    const r = await ingestIgEvents(asClient(t), [ev({ igUserId: "nope" }), ev({ igUserId: "ig-R", providerId: "z" })]);
    expect(r.unknownAccount).toBe(2);
    expect(t.ig_interactions).toHaveLength(0);
  });
  it("the account's own comment is stored as ignored so the desk can't reply to itself", async () => {
    const r = await ingestIgEvents(asClient(t), [ev({ authorId: "ig-A", providerId: "own" })]);
    expect(r).toMatchObject({ stored: 0, ignored: 1 });
    expect(t.ig_interactions[0].status).toBe("ignored");
  });
  it("a mention whose lookup fails is still stored (without text)", async () => {
    const enrich = vi.fn().mockRejectedValue(new Error("graph down"));
    await ingestIgEvents(asClient(t), [ev({ kind: "mention", providerId: "mc2", authorId: null, text: null, mention: { commentId: "mc2" } })], { enrich });
    expect(t.ig_interactions).toHaveLength(1);
    expect(t.ig_interactions[0].text).toBeNull();
  });
  it("an empty batch is a no-op", async () => {
    expect(await ingestIgEvents(asClient(t), [])).toEqual({ stored: 0, duplicate: 0, ignored: 0, unknownAccount: 0 });
  });
});

describe("F2 tag polling", () => {
  it("stores new tagged posts once and stops paging on known ones", async () => {
    const t = seed();
    const fetchTags = vi.fn().mockResolvedValue([
      { id: "p1", username: "someone", caption: "with @mla", permalink: "https://ig/p/1", timestamp: "2026-11-17T10:00:00+0000" },
    ]);
    const client = asClient(t);
    expect((await pollIgTags(client, { fetch: fetchTags })).stored).toBe(2); // tenant A and B accounts both poll
    expect((await pollIgTags(client, { fetch: fetchTags })).stored).toBe(0); // second poll: nothing new
    expect(t.ig_interactions.filter((x) => x.kind === "tag")).toHaveLength(2);
    expect(t.ig_interactions[0]).toMatchObject({ kind: "tag", author_handle: "someone", text: "with @mla", media_id: "p1" });
  });
  it("one account failing does not stop the others", async () => {
    const t = seed();
    const fetchTags = vi.fn().mockRejectedValueOnce(new Error("token revoked")).mockResolvedValue([
      { id: "p9", username: "x", caption: null, permalink: null, timestamp: null },
    ]);
    const r = await pollIgTags(asClient(t), { fetch: fetchTags });
    expect(r).toMatchObject({ accounts: 2, failed: 1, stored: 1 });
  });
  it("can be limited to one tenant (manual refresh)", async () => {
    const t = seed();
    const fetchTags = vi.fn().mockResolvedValue([]);
    await pollIgTags(asClient(t), { fetch: fetchTags, tenantId: "tenant-B" });
    expect(fetchTags).toHaveBeenCalledTimes(1);
    expect(fetchTags).toHaveBeenCalledWith("ig-B", "tokB");
  });
});

describe("F2 webhook route", () => {
  const secret = "ig-secret";
  const payload = {
    object: "instagram",
    entry: [{ id: "ig-A", time: 1_763_424_000, changes: [{ field: "comments", value: { id: "c1", text: "hello", from: { id: "u9", username: "cit" }, media: { id: "m1" } } }] }],
  };
  const post = (raw: string, sig: string | null) =>
    POST(new NextRequest("https://crm.example.com/api/ig/webhook", { method: "POST", body: raw, headers: sig ? { "x-hub-signature-256": sig } : {} }));
  const sign = (raw: string, s = secret) => "sha256=" + crypto.createHmac("sha256", s).update(raw).digest("hex");

  beforeEach(() => {
    process.env.IG_APP_SECRET = secret;
    process.env.IG_VERIFY_TOKEN = "vt";
    h.state.tables = seed();
  });

  it("a correctly signed delivery stores the comment", async () => {
    const raw = JSON.stringify(payload);
    const r = await post(raw, sign(raw));
    expect(r.status).toBe(200);
    expect(h.state.tables.ig_interactions).toHaveLength(1);
    expect(h.state.tables.ig_interactions[0]).toMatchObject({ kind: "comment", provider_id: "c1", tenant_id: "tenant-A" });
  });
  it("redelivery of the same payload 3 times keeps one row", async () => {
    const raw = JSON.stringify(payload);
    for (let i = 0; i < 3; i++) await post(raw, sign(raw));
    expect(h.state.tables.ig_interactions).toHaveLength(1);
  });
  it("a tampered signature stores nothing but still answers 200", async () => {
    const raw = JSON.stringify(payload);
    expect((await post(raw, sign(raw, "wrong"))).status).toBe(200);
    expect((await post(raw, null)).status).toBe(200);
    expect(h.state.tables.ig_interactions).toHaveLength(0);
  });
  it("a signed but malformed body is swallowed with 200", async () => {
    const raw = "{not json";
    expect((await post(raw, sign(raw))).status).toBe(200);
    expect(h.state.tables.ig_interactions).toHaveLength(0);
  });
  it("GET verification echoes the challenge only for the right token", async () => {
    const url = (tok: string) => new NextRequest(`https://crm.example.com/api/ig/webhook?hub.mode=subscribe&hub.verify_token=${tok}&hub.challenge=abc123`);
    const ok = await GET(url("vt"));
    expect([ok.status, await ok.text()]).toEqual([200, "abc123"]);
    expect((await GET(url("bad"))).status).toBe(403);
  });
  it("parser + ingest agree end to end on a mixed delivery", async () => {
    const mixed = { entry: [{ id: "ig-A", time: 1, changes: [{ field: "comments", value: { id: "c5" } }], messaging: [{ sender: { id: "u1" }, timestamp: 1, message: { mid: "m5", text: "dm" } }] }] };
    await ingestIgEvents(asClient(h.state.tables), parseIgWebhook(mixed));
    expect(h.state.tables.ig_interactions.map((x) => x.kind).sort()).toEqual(["comment", "dm"]);
  });
});

describe("F2 security: interactions are tenant-readable only", () => {
  const sql = readFileSync("supabase/migrations/0065_ig_interactions.sql", "utf8");
  it("RLS scopes reads to the caller's tenant and the raw payload is not granted", () => {
    expect(sql).toMatch(/tenant_id = public\.current_tenant_id\(\)/);
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.ig_interactions to authenticated/)![1];
    expect(grant).not.toMatch(/\braw\b/);
    expect(sql).toMatch(/unique \(ig_account_id, provider_id\)/);
  });
});
