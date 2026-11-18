import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAdmin } from "./fake-admin";
import { DEFAULT_DESK_BLOCKLIST, mergeBlocklist, mergeDeskBranding } from "@/lib/social-desk-setup";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({ ctx: {} as Record<string, unknown>, state: { tables: {} as Rows } }));
vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { loadSocialDeskStatus, setupSocialDesk } from "@/app/(platform)/platform/actions";

beforeEach(() => {
  Object.assign(h.ctx, { userId: "pa", tenantId: "platform", isPlatformAdmin: true });
  h.state.tables = {
    tenants: [{ id: "MLA" }, { id: "OTHER" }],
    organization_branding: [{ tenant_id: "MLA", module_labels: { deals: "Cases" }, module_visibility: { invoices: false } }],
    ig_desk_settings: [],
    ig_accounts: [],
  };
});

describe("F7 merge helpers", () => {
  it("switches Social on and keeps the tenant's other labels and hidden modules", () => {
    expect(mergeDeskBranding({ module_labels: { deals: "Cases" }, module_visibility: { invoices: false } }, true)).toEqual({
      module_labels: { deals: "Cases", leads: "Issues" },
      module_visibility: { invoices: false, social: true },
    });
    expect(mergeDeskBranding(null, false)).toEqual({ module_labels: {}, module_visibility: { social: true } });
  });
  it("blocklist merge adds the starter words once, keeps the tenant's own words", () => {
    const m = mergeBlocklist(["Complaint", "flood"]);
    expect(m.filter((w) => w.toLowerCase() === "complaint")).toHaveLength(1);
    expect(m).toContain("flood");
    expect(mergeBlocklist(m)).toEqual(m); // idempotent
    expect(mergeBlocklist(null)).toEqual(DEFAULT_DESK_BLOCKLIST);
  });
});

describe("F7 setup action", () => {
  it("sets up a tenant in one action: Social on, Issues label, approval required, starter blocklist", async () => {
    const r = await setupSocialDesk({ tenantId: "MLA", renameLeads: true });
    expect(r.ok).toBe(true);
    expect(h.state.tables.organization_branding[0]).toMatchObject({
      module_labels: { deals: "Cases", leads: "Issues" },
      module_visibility: { invoices: false, social: true },
    });
    expect(h.state.tables.ig_desk_settings[0]).toMatchObject({ tenant_id: "MLA", reply_mode: "human_approval", allow_self_approve: false });
    expect(h.state.tables.ig_desk_settings[0].blocklist).toEqual(DEFAULT_DESK_BLOCKLIST);
    expect(r.status).toMatchObject({ socialEnabled: true, leadsLabel: "Issues", hasSettings: true, replyMode: "human_approval" });
  });
  it("re-running changes nothing the tenant chose (mode, self-approval, extra blocklist words)", async () => {
    await setupSocialDesk({ tenantId: "MLA", renameLeads: true });
    Object.assign(h.state.tables.ig_desk_settings[0], { reply_mode: "direct", allow_self_approve: true, blocklist: [...DEFAULT_DESK_BLOCKLIST, "flood"] });
    await setupSocialDesk({ tenantId: "MLA", renameLeads: true });
    expect(h.state.tables.ig_desk_settings).toHaveLength(1);
    expect(h.state.tables.ig_desk_settings[0]).toMatchObject({ reply_mode: "direct", allow_self_approve: true });
    expect(h.state.tables.ig_desk_settings[0].blocklist).toEqual([...DEFAULT_DESK_BLOCKLIST, "flood"]);
    expect(h.state.tables.organization_branding).toHaveLength(1);
  });
  it("works for a tenant with no branding row yet, without renaming when not asked", async () => {
    expect((await setupSocialDesk({ tenantId: "OTHER", renameLeads: false })).ok).toBe(true);
    const row = h.state.tables.organization_branding.find((b) => b.tenant_id === "OTHER")!;
    expect(row).toMatchObject({ module_labels: {}, module_visibility: { social: true } });
  });
  it("only platform admins can run it or read the status; unknown tenants are refused", async () => {
    expect((await setupSocialDesk({ tenantId: "NOPE", renameLeads: true })).ok).toBe(false);
    h.ctx.isPlatformAdmin = false;
    expect((await setupSocialDesk({ tenantId: "MLA", renameLeads: true })).ok).toBe(false);
    expect((await loadSocialDeskStatus("MLA")).socialEnabled).toBe(false);
    expect(h.state.tables.ig_desk_settings).toHaveLength(0);
  });
});
