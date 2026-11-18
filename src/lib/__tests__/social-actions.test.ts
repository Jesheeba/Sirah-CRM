import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./fake-admin";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({
  ctx: { userId: "u-admin", tenantId: "tenant-A", isAdmin: true, isManager: false, isRep: false } as Record<string, unknown>,
  state: { tables: {} as Rows },
  poll: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ig-ingest", () => ({ pollIgTags: h.poll }));

import { assignInteraction, refreshTaggedPosts, setInteractionIgnored } from "@/app/(app)/social/actions";

const row = (id: string) => h.state.tables.ig_interactions.find((r) => r.id === id)!;

beforeEach(() => {
  Object.assign(h.ctx, { tenantId: "tenant-A", isAdmin: true, isManager: false, isRep: false });
  h.state.tables = {
    profiles: [
      { id: "p-A", tenant_id: "tenant-A" },
      { id: "p-B", tenant_id: "tenant-B" },
    ],
    ig_interactions: [
      { id: "i1", tenant_id: "tenant-A", status: "new", assigned_to: null },
      { id: "i2", tenant_id: "tenant-B", status: "new", assigned_to: null },
      { id: "i3", tenant_id: "tenant-A", status: "replied", assigned_to: null },
    ],
  };
  h.poll.mockReset();
});

describe("F3 assign", () => {
  it("an admin assigns an item to a teammate; it becomes assigned", async () => {
    expect(await assignInteraction("i1", "p-A")).toEqual({ ok: true });
    expect(row("i1")).toMatchObject({ assigned_to: "p-A", status: "assigned" });
  });
  it("unassigning returns it to new", async () => {
    await assignInteraction("i1", "p-A");
    await assignInteraction("i1", null);
    expect(row("i1")).toMatchObject({ assigned_to: null, status: "new" });
  });
  it("cannot assign to someone in another organization", async () => {
    expect((await assignInteraction("i1", "p-B")).ok).toBe(false);
    expect(row("i1").assigned_to).toBeNull();
  });
  it("cannot touch another organization's item", async () => {
    expect(await assignInteraction("i2", "p-A")).toEqual({ ok: false, error: "Item not found." });
    expect(row("i2").assigned_to).toBeNull();
  });
  it("a manager may assign; a rep may not (server-checked)", async () => {
    Object.assign(h.ctx, { isAdmin: false, isManager: true });
    expect((await assignInteraction("i1", "p-A")).ok).toBe(true);
    Object.assign(h.ctx, { isAdmin: false, isManager: false, isRep: true });
    expect((await assignInteraction("i1", null)).ok).toBe(false);
    expect(row("i1").assigned_to).toBe("p-A");
  });
});

describe("F3 ignore / restore", () => {
  it("ignores an open item and restores it", async () => {
    expect((await setInteractionIgnored("i1", true)).ok).toBe(true);
    expect(row("i1").status).toBe("ignored");
    expect((await setInteractionIgnored("i1", false)).ok).toBe(true);
    expect(row("i1").status).toBe("new");
  });
  it("refuses to ignore a finished item or restore one that isn't ignored", async () => {
    expect((await setInteractionIgnored("i3", true)).ok).toBe(false);
    expect((await setInteractionIgnored("i1", false)).ok).toBe(false);
    expect(row("i3").status).toBe("replied");
  });
  it("cannot ignore another organization's item; a rep cannot ignore", async () => {
    expect((await setInteractionIgnored("i2", true)).ok).toBe(false);
    Object.assign(h.ctx, { isAdmin: false, isRep: true });
    expect((await setInteractionIgnored("i1", true)).ok).toBe(false);
    expect(row("i1").status).toBe("new");
  });
});

describe("F3 refresh tagged posts", () => {
  it("polls only this organization's accounts and reports how many were new", async () => {
    h.poll.mockResolvedValue({ accounts: 1, stored: 2, failed: 0 });
    expect(await refreshTaggedPosts()).toEqual({ ok: true, stored: 2 });
    expect(h.poll.mock.calls[0][1]).toEqual({ tenantId: "tenant-A" });
  });
  it("reports a failure when Instagram doesn't answer", async () => {
    h.poll.mockResolvedValue({ accounts: 1, stored: 0, failed: 1 });
    expect((await refreshTaggedPosts()).ok).toBe(false);
  });
  it("a rep cannot trigger it", async () => {
    Object.assign(h.ctx, { isAdmin: false, isRep: true });
    expect((await refreshTaggedPosts()).ok).toBe(false);
    expect(h.poll).not.toHaveBeenCalled();
  });
});
