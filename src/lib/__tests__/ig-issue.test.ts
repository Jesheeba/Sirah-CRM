import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./fake-admin";
import { issueLeadFields, pickExistingLead } from "@/lib/ig-issue";
import { toFeedLead } from "@/lib/lead-feed";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({ ctx: {} as Record<string, unknown>, state: { tables: {} as Rows }, poll: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ig-ingest", () => ({ pollIgTags: h.poll }));

import { createIssueFromInteraction } from "@/app/(app)/social/actions";

const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
const it_ = (id: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: "T", ig_account_id: "acc", kind: "comment", author_handle: "citizen_a", text: "Road is broken near school",
  permalink: "https://instagram.com/p/x", assigned_to: null, lead_id: null, status: "new", ...over,
});
const leads = () => h.state.tables.leads;
const item = (id: string) => h.state.tables.ig_interactions.find((r) => r.id === id)!;

beforeEach(() => {
  Object.assign(h.ctx, { userId: "u-rep", tenantId: "T", isAdmin: false, isManager: false });
  h.state.tables = {
    ig_interactions: [it_("i1"), it_("i2", { text: "Still not fixed" }), it_("i3", { author_handle: "someone_else" }), it_("x1", { tenant_id: "X" })],
    leads: [],
  };
});

describe("F5 create issue", () => {
  it("one click creates exactly one lead with the right source, owner and origin fields", async () => {
    const r = await createIssueFromInteraction("i1");
    expect(r).toMatchObject({ ok: true, how: "created" });
    expect(leads()).toHaveLength(1);
    expect(leads()[0]).toMatchObject({
      tenant_id: "T", first_name: "@citizen_a", source: "Instagram Comment", status: "new", owner_id: "u-rep",
      custom_fields: { ig_interaction_id: "i1", ig_handle: "citizen_a", ig_text: "Road is broken near school", ig_kind: "comment" },
    });
    expect(item("i1")).toMatchObject({ lead_id: r.leadId, status: "issue" });
  });
  it("a second click returns the same lead", async () => {
    const a = await createIssueFromInteraction("i1");
    const b = await createIssueFromInteraction("i1");
    expect(b).toMatchObject({ ok: true, how: "existing", leadId: a.leadId });
    expect(leads()).toHaveLength(1);
  });
  it("the same person's recent open lead is reused instead of duplicating", async () => {
    const a = await createIssueFromInteraction("i1");
    leads()[0].created_at = days(2);
    const b = await createIssueFromInteraction("i2");
    expect(b).toMatchObject({ how: "attached", leadId: a.leadId });
    expect(leads()).toHaveLength(1);
    expect(item("i2").lead_id).toBe(a.leadId);
  });
  it("…but not an old or converted one, and not someone else's", async () => {
    await createIssueFromInteraction("i1");
    leads()[0].created_at = days(40);
    expect((await createIssueFromInteraction("i2")).how).toBe("created");
    expect((await createIssueFromInteraction("i3")).how).toBe("created");
    expect(leads()).toHaveLength(3);
  });
  it("owner is the item's assignee when there is one", async () => {
    item("i3").assigned_to = "u-assignee";
    await createIssueFromInteraction("i3");
    expect(leads()[0].owner_id).toBe("u-assignee");
  });
  it("a deleted lead doesn't count: a new one is created", async () => {
    const a = await createIssueFromInteraction("i1");
    leads()[0].deleted_at = new Date().toISOString();
    const b = await createIssueFromInteraction("i1");
    expect(b.how).toBe("created");
    expect(b.leadId).not.toBe(a.leadId);
  });
  it("can't turn another organization's item into a lead", async () => {
    expect((await createIssueFromInteraction("x1")).ok).toBe(false);
    expect(leads()).toHaveLength(0);
  });
});

describe("F5 lead fields and regressions", () => {
  it("no handle → 'Instagram user'; long text is capped; DMs and mentions get their own source", () => {
    expect(issueLeadFields({ id: "a", kind: "dm", author_handle: null, text: "x".repeat(3000), permalink: null })).toMatchObject({
      first_name: "Instagram user", source: "Instagram Message",
    });
    expect(issueLeadFields({ id: "a", kind: "dm", author_handle: null, text: "x".repeat(3000), permalink: null }).custom_fields.ig_text).toHaveLength(2000);
    expect(issueLeadFields({ id: "a", kind: "mention", author_handle: "n", text: null, permalink: null }).source).toBe("Instagram Mention");
  });
  it("pickExistingLead prefers the newest open lead within 30 days", () => {
    expect(pickExistingLead([
      { id: "old", created_at: days(10), status: "new" },
      { id: "new", created_at: days(1), status: "contacted" },
      { id: "conv", created_at: days(0), status: "converted" },
    ])).toBe("new");
    expect(pickExistingLead([{ id: "x", created_at: days(31), status: "new" }])).toBeNull();
  });
  it("the Meta lead pull feed is unchanged: Instagram issues carry no fb_leadgen_id and ig_ fields stay out of Meta fields", () => {
    const fields = issueLeadFields({ id: "i", kind: "comment", author_handle: "c", text: "t", permalink: null });
    expect(fields.custom_fields).not.toHaveProperty("fb_leadgen_id");
    const feed = toFeedLead(
      { id: "L", first_name: "@c", last_name: null, email: null, phone: null, company: null, source: fields.source, created_at: "2026-11-18T00:00:00Z", custom_fields: fields.custom_fields },
      new Map(),
    );
    expect(feed.leadgen_id).toBeNull(); // the feed's query filters on fb_leadgen_id, so this lead is never exported
  });
});
