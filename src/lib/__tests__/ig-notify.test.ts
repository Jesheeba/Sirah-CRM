import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeAdmin } from "./fake-admin";
import { notifyIgMentions, type MentionItem } from "@/lib/ig-notify";
import { ingestIgEvents } from "@/lib/ig-ingest";
import type { IgEvent } from "@/lib/ig-webhook";

type Rows = Record<string, Record<string, unknown>[]>;
let t: Rows;
const now = Date.parse("2026-11-19T12:00:00Z");
const recent = new Date(now - 3600_000).toISOString();
const item = (over: Partial<MentionItem> = {}): MentionItem => ({
  id: "i1", tenant_id: "T", kind: "mention", author_handle: "citizen", text: "@mla please fix the road", created_at_provider: recent, ...over,
});
const run = (items: MentionItem[]) => notifyIgMentions(new FakeAdmin(t) as unknown as SupabaseClient, items, now);
const notes = () => t.notifications ?? [];

beforeEach(() => {
  t = {
    roles: [
      { id: "rA", tenant_id: "T", name: "Admin" }, { id: "rM", tenant_id: "T", name: "Manager" },
      { id: "rS", tenant_id: "T", name: "Sales Rep" }, { id: "xA", tenant_id: "X", name: "Admin" },
    ],
    user_roles: [
      { tenant_id: "T", user_id: "admin", role_id: "rA" }, { tenant_id: "T", user_id: "mgr", role_id: "rM" },
      { tenant_id: "T", user_id: "rep", role_id: "rS" }, { tenant_id: "X", user_id: "other", role_id: "xA" },
    ],
    notification_preferences: [],
    notifications: [],
  };
});

describe("ig-mention-alerts", () => {
  it("AC1 a new mention notifies each Admin and Manager of the tenant once, linking to the item; reps and other tenants get nothing", async () => {
    await run([item()]);
    expect(notes().map((n) => n.user_id).sort()).toEqual(["admin", "mgr"]);
    expect(notes()[0]).toMatchObject({
      tenant_id: "T", type: "ig_mention", title: "@citizen mentioned you", body: "@mla please fix the road",
      link: "/social/i1", entity_type: "ig_interaction", entity_id: "i1",
    });
  });
  it("AC1 a tag reads 'tagged you in a post'; no handle reads 'Someone'", async () => {
    await run([item({ kind: "tag", author_handle: null })]);
    expect(notes()[0].title).toBe("Someone tagged you in a post");
  });
  it("AC2 a user who turned off Instagram mention alerts gets none", async () => {
    t.notification_preferences.push({ user_id: "mgr", type: "ig_mention", in_app: false });
    await run([item()]);
    expect(notes().map((n) => n.user_id)).toEqual(["admin"]);
  });
  it("AC3 an old tag (e.g. the first poll) does not notify", async () => {
    await run([item({ kind: "tag", created_at_provider: new Date(now - 72 * 3600_000).toISOString() })]);
    expect(notes()).toHaveLength(0);
  });
  it("AC4 more than 5 in one delivery becomes one summary per user", async () => {
    await run(Array.from({ length: 7 }, (_, k) => item({ id: `m${k}` })));
    expect(notes()).toHaveLength(2);
    expect(notes()[0]).toMatchObject({ title: "7 new Instagram mentions or tags", link: "/social" });
  });
  it("AC5 comments and DMs do not notify", async () => {
    await run([item({ kind: "comment" }), item({ kind: "dm" })]);
    expect(notes()).toHaveLength(0);
  });
  it("AC5 through ingest: a mention alerts once, its redelivery does not alert again", async () => {
    t.ig_accounts = [{ id: "acc", tenant_id: "T", ig_user_id: "ig-1", access_token: "tok", status: "active" }];
    t.ig_interactions = [];
    const ev: IgEvent = {
      igUserId: "ig-1", kind: "mention", providerId: "mc1", authorId: null, authorHandle: null, text: null, mediaId: null,
      permalink: null, parentId: null, occurredAt: new Date().toISOString(), raw: {}, mention: { commentId: "mc1" },
    };
    const enrich = async () => ({ text: "@mla hi", authorHandle: "fan", mediaId: "p", permalink: null, occurredAt: null });
    const client = new FakeAdmin(t) as unknown as SupabaseClient;
    await ingestIgEvents(client, [ev], { enrich });
    await ingestIgEvents(client, [ev], { enrich });
    expect(notes().map((n) => [n.user_id, n.title]).sort()).toEqual([["admin", "@fan mentioned you"], ["mgr", "@fan mentioned you"]]);
  });
});
