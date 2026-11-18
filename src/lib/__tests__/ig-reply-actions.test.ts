import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./fake-admin";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({
  ctx: {} as Record<string, unknown>,
  state: { tables: {} as Rows },
  send: { postCommentReply: vi.fn(), postMentionReply: vi.fn(), sendDm: vi.fn(), sendPrivateReply: vi.fn() },
}));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ig-send", () => h.send);

import { approveReply, rejectReply, retryReply, setReplyMode, submitReply } from "@/app/(app)/social/reply-actions";

const recent = () => new Date(Date.now() - 3600_000).toISOString();
const old = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const as = (who: "admin" | "manager" | "rep" | "otherTenant") =>
  Object.assign(h.ctx, {
    admin: { userId: "u-admin", tenantId: "T", isAdmin: true, isManager: false },
    manager: { userId: "u-mgr", tenantId: "T", isAdmin: false, isManager: true },
    rep: { userId: "u-rep", tenantId: "T", isAdmin: false, isManager: false },
    otherTenant: { userId: "u-x", tenantId: "X", isAdmin: true, isManager: false },
  }[who]);
const replies = () => h.state.tables.ig_replies;
const anySend = () => Object.values(h.send).reduce((n, f) => n + f.mock.calls.length, 0);

beforeEach(() => {
  as("rep");
  Object.values(h.send).forEach((f) => f.mockReset().mockResolvedValue("ig-reply-1"));
  h.state.tables = {
    ig_accounts: [{ id: "acc", tenant_id: "T", ig_user_id: "ig-1", access_token: "tok", status: "active" }],
    ig_interactions: [
      { id: "c1", tenant_id: "T", ig_account_id: "acc", kind: "comment", provider_id: "cmt-1", author_id: "u9", media_id: "m1", created_at_provider: recent(), received_at: recent(), status: "new" },
      { id: "d1", tenant_id: "T", ig_account_id: "acc", kind: "dm", provider_id: "mid-1", author_id: "u9", media_id: null, created_at_provider: recent(), received_at: recent(), status: "new" },
      { id: "dOld", tenant_id: "T", ig_account_id: "acc", kind: "dm", provider_id: "mid-2", author_id: "u8", media_id: null, created_at_provider: old(2), received_at: old(2), status: "new" },
      { id: "t1", tenant_id: "T", ig_account_id: "acc", kind: "tag", provider_id: "p1", author_id: null, media_id: "p1", created_at_provider: recent(), received_at: recent(), status: "new" },
      { id: "mn", tenant_id: "T", ig_account_id: "acc", kind: "mention", provider_id: "mc", author_id: null, media_id: "theirpost", created_at_provider: recent(), received_at: recent(), status: "new" },
      { id: "xT", tenant_id: "X", ig_account_id: "acc", kind: "comment", provider_id: "cmt-x", author_id: "u9", media_id: "m", created_at_provider: recent(), received_at: recent(), status: "new" },
    ],
    ig_replies: [],
    ig_reply_events: [],
    ig_desk_settings: [],
  };
});

describe("F4 human approval (default)", () => {
  it("a written reply waits: nothing reaches Instagram until approved", async () => {
    expect(await submitReply({ interactionId: "c1", channel: "public", body: "Office is at Main Rd." })).toEqual({ ok: true, status: "pending_approval" });
    expect(anySend()).toBe(0);
    expect(replies()[0]).toMatchObject({ status: "pending_approval", drafted_by: "u-rep", body: "Office is at Main Rd." });
  });
  it("approving posts it once, marks it sent and the item replied, with an audit trail", async () => {
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("manager");
    expect(await approveReply(replies()[0].id as string)).toEqual({ ok: true, status: "sent" });
    expect(h.send.postCommentReply).toHaveBeenCalledWith("cmt-1", "Hello", "tok");
    expect(replies()[0]).toMatchObject({ status: "sent", approved_by: "u-mgr", provider_reply_id: "ig-reply-1" });
    expect(h.state.tables.ig_interactions.find((r) => r.id === "c1")!.status).toBe("replied");
    expect(h.state.tables.ig_reply_events.map((e) => e.action)).toEqual(["drafted", "approved", "sent"]);
  });
  it("approving twice (double click) posts exactly once", async () => {
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("manager");
    const id = replies()[0].id as string;
    await approveReply(id);
    expect((await approveReply(id)).ok).toBe(false);
    expect(h.send.postCommentReply).toHaveBeenCalledTimes(1);
  });
  it("a rejected reply is never sent", async () => {
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("manager");
    const id = replies()[0].id as string;
    expect((await rejectReply(id, "tone")).ok).toBe(true);
    expect((await approveReply(id)).ok).toBe(false);
    expect(anySend()).toBe(0);
    expect(replies()[0].status).toBe("rejected");
  });
  it("the writer cannot approve their own reply; a rep cannot approve at all", async () => {
    as("manager");
    await submitReply({ interactionId: "c1", channel: "public", body: "Mine" });
    expect((await approveReply(replies()[0].id as string)).ok).toBe(false);
    as("rep");
    expect((await approveReply(replies()[0].id as string)).ok).toBe(false);
    expect(anySend()).toBe(0);
  });
  it("…unless the organization allows self-approval", async () => {
    h.state.tables.ig_desk_settings.push({ tenant_id: "T", reply_mode: "human_approval", allow_self_approve: true });
    as("manager");
    await submitReply({ interactionId: "c1", channel: "public", body: "Mine" });
    expect((await approveReply(replies()[0].id as string)).status).toBe("sent");
  });
});

describe("F4 direct mode", () => {
  beforeEach(() => { h.state.tables.ig_desk_settings.push({ tenant_id: "T", reply_mode: "direct", allow_self_approve: false }); });
  it("an admin/manager reply posts immediately", async () => {
    as("admin");
    expect(await submitReply({ interactionId: "d1", channel: "dm", body: "We'll call you" })).toEqual({ ok: true, status: "sent" });
    expect(h.send.sendDm).toHaveBeenCalledWith("ig-1", "u9", "We'll call you", "tok");
  });
  it("a rep's reply still waits for approval", async () => {
    as("rep");
    expect((await submitReply({ interactionId: "d1", channel: "dm", body: "x" })).status).toBe("pending_approval");
    expect(anySend()).toBe(0);
  });
});

describe("F4 Instagram rules enforced on the server", () => {
  it("refuses a DM reply after the 24-hour window", async () => {
    const r = await submitReply({ interactionId: "dOld", channel: "dm", body: "late" });
    expect(r.ok).toBe(false);
    expect(replies()).toHaveLength(0);
  });
  it("allows one private reply per comment", async () => {
    h.state.tables.ig_desk_settings.push({ tenant_id: "T", reply_mode: "direct", allow_self_approve: false });
    as("admin");
    expect((await submitReply({ interactionId: "c1", channel: "private", body: "DMing you" })).status).toBe("sent");
    expect(h.send.sendPrivateReply).toHaveBeenCalledWith("ig-1", "cmt-1", "DMing you", "tok");
    expect((await submitReply({ interactionId: "c1", channel: "private", body: "again" })).ok).toBe(false);
  });
  it("tagged posts can't be answered; a DM item can't get a public reply", async () => {
    expect((await submitReply({ interactionId: "t1", channel: "public", body: "x" })).ok).toBe(false);
    expect((await submitReply({ interactionId: "d1", channel: "public", body: "x" })).ok).toBe(false);
  });
  it("a comment mention is answered through the mentions endpoint", async () => {
    h.state.tables.ig_desk_settings.push({ tenant_id: "T", reply_mode: "direct", allow_self_approve: false });
    as("admin");
    await submitReply({ interactionId: "mn", channel: "public", body: "Thanks!" });
    expect(h.send.postMentionReply).toHaveBeenCalledWith("ig-1", "mc", "theirpost", "Thanks!", "tok");
  });
  it("empty or too-long text is refused", async () => {
    expect((await submitReply({ interactionId: "c1", channel: "public", body: "   " })).ok).toBe(false);
    expect((await submitReply({ interactionId: "d1", channel: "dm", body: "x".repeat(1001) })).ok).toBe(false);
  });
});

describe("F4 failures, retry and isolation", () => {
  it("Instagram refusing marks it failed with the reason; retry puts it back for approval", async () => {
    h.send.postCommentReply.mockRejectedValueOnce(new Error("(#10) not allowed"));
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("manager");
    const id = replies()[0].id as string;
    const r = await approveReply(id);
    expect(r).toMatchObject({ ok: false, status: "failed" });
    expect(replies()[0]).toMatchObject({ status: "failed" });
    expect(String(replies()[0].error)).toContain("(#10)");
    expect(h.state.tables.ig_interactions.find((x) => x.id === "c1")!.status).toBe("new");
    expect((await retryReply(id)).status).toBe("pending_approval");
    expect((await approveReply(id)).status).toBe("sent");
  });
  it("a disconnected account fails safely without calling Instagram", async () => {
    h.state.tables.ig_accounts[0].status = "expired";
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("manager");
    expect((await approveReply(replies()[0].id as string)).status).toBe("failed");
    expect(anySend()).toBe(0);
  });
  it("another organization can't reply to, approve or reject our items", async () => {
    await submitReply({ interactionId: "c1", channel: "public", body: "Hello" });
    as("otherTenant");
    expect((await submitReply({ interactionId: "c1", channel: "public", body: "x" })).ok).toBe(false);
    expect((await approveReply(replies()[0].id as string)).ok).toBe(false);
    expect((await rejectReply(replies()[0].id as string)).ok).toBe(false);
    expect(replies()[0].status).toBe("pending_approval");
    as("rep");
    expect((await submitReply({ interactionId: "xT", channel: "public", body: "x" })).ok).toBe(false);
  });
  it("only admins change the reply mode", async () => {
    as("manager");
    expect((await setReplyMode("direct", false)).ok).toBe(false);
    as("admin");
    expect((await setReplyMode("direct", true)).ok).toBe(true);
    expect(h.state.tables.ig_desk_settings[0]).toMatchObject({ reply_mode: "direct", allow_self_approve: true });
  });
});
