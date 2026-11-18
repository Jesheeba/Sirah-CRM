import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeAdmin } from "./fake-admin";

const h = vi.hoisted(() => ({
  ctx: { userId: "u1", tenantId: "tenant-A", isAdmin: true },
  state: { tables: {} as Record<string, Record<string, unknown>[]> },
  net: { exchangeIgCode: vi.fn(), fetchAssignedIgAccounts: vi.fn(), subscribeIgAccount: vi.fn() },
}));
const { ctx, net } = h;
let tables: Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("@/lib/ig-login", async (orig) => ({ ...(await orig<typeof import("@/lib/ig-login")>()), ...h.net }));

import { GET } from "@/app/api/ig/oauth/callback/route";

const call = (qs: string, cookie: string | null = "ig_oauth_state=S1") =>
  GET(new NextRequest(`https://crm.example.com/api/ig/oauth/callback?${qs}`, { headers: cookie ? { cookie } : {} }));
const loc = (r: Response) => new URL(r.headers.get("location")!).search;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
  tables = h.state.tables = { ig_accounts: [] };
  ctx.isAdmin = true;
  ctx.tenantId = "tenant-A";
  net.exchangeIgCode.mockReset().mockResolvedValue({ accessToken: "suat", expiresAt: null });
  net.fetchAssignedIgAccounts.mockReset().mockResolvedValue([{ userId: "ig-1", username: "mla_office" }]);
  net.subscribeIgAccount.mockReset().mockResolvedValue(true);
});

describe("F1 callback (Unified Login)", () => {
  it("connects the shared account: stores username + never-expiring token server-side and subscribes it", async () => {
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=1&accounts=1");
    expect(net.exchangeIgCode).toHaveBeenCalledWith("abc");
    expect(net.subscribeIgAccount).toHaveBeenCalledWith("ig-1", "suat");
    expect(tables.ig_accounts[0]).toMatchObject({
      tenant_id: "tenant-A", ig_user_id: "ig-1", username: "mla_office", access_token: "suat", token_expires_at: null, status: "active", webhook_subscribed: true,
    });
  });
  it("connects every account the client shared in one login", async () => {
    net.fetchAssignedIgAccounts.mockResolvedValue([{ userId: "ig-1", username: "a" }, { userId: "ig-2", username: "b" }]);
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=1&accounts=2");
    expect(tables.ig_accounts.map((r) => r.ig_user_id)).toEqual(["ig-1", "ig-2"]);
  });
  it("no account shared → clear message, nothing saved", async () => {
    net.fetchAssignedIgAccounts.mockResolvedValue([]);
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=error&reason=noaccount");
    expect(tables.ig_accounts).toHaveLength(0);
  });
  it("a second tenant cannot attach an account another tenant already has; others in the same login still connect", async () => {
    tables.ig_accounts.push({ id: "x", tenant_id: "tenant-B", ig_user_id: "ig-1", access_token: "theirs" });
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=error&reason=taken");
    expect(tables.ig_accounts[0]).toMatchObject({ tenant_id: "tenant-B", access_token: "theirs" });
    net.fetchAssignedIgAccounts.mockResolvedValue([{ userId: "ig-1", username: "a" }, { userId: "ig-3", username: "c" }]);
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=1&accounts=1");
    expect(tables.ig_accounts.find((r) => r.ig_user_id === "ig-3")).toMatchObject({ tenant_id: "tenant-A" });
  });
  it("reconnecting the same tenant's account updates it instead of duplicating", async () => {
    tables.ig_accounts.push({ id: "x", tenant_id: "tenant-A", ig_user_id: "ig-1", access_token: "old", status: "revoked" });
    await call("code=abc&state=S1");
    expect(tables.ig_accounts).toHaveLength(1);
    expect(tables.ig_accounts[0]).toMatchObject({ access_token: "suat", status: "active" });
  });
  it("still connects when the webhook subscription fails, and says so", async () => {
    net.subscribeIgAccount.mockRejectedValue(new Error("nope"));
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=0&accounts=1");
    expect(tables.ig_accounts[0].webhook_subscribed).toBe(false);
  });
  it("rejects a missing or mismatched CSRF state and never calls Meta", async () => {
    expect(loc(await call("code=abc&state=OTHER"))).toBe("?ig=error&reason=state");
    expect(loc(await call("code=abc&state=S1", null))).toBe("?ig=error&reason=state");
    expect(loc(await call("state=S1"))).toBe("?ig=error&reason=state");
    expect(net.exchangeIgCode).not.toHaveBeenCalled();
  });
  it("handles the user cancelling, and a failed exchange, without saving", async () => {
    expect(loc(await call("error=access_denied&state=S1"))).toBe("?ig=error&reason=denied");
    net.exchangeIgCode.mockRejectedValue(new Error("secret internals"));
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=error&reason=oauth");
    expect(tables.ig_accounts).toHaveLength(0);
  });
  it("is admin-only: a non-admin is sent away before any Meta call", async () => {
    ctx.isAdmin = false;
    const r = await call("code=abc&state=S1");
    expect(new URL(r.headers.get("location")!).pathname).toBe("/dashboard");
    expect(net.exchangeIgCode).not.toHaveBeenCalled();
  });
});
