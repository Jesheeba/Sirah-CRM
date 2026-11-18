import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeAdmin } from "./fake-admin";

const h = vi.hoisted(() => ({
  ctx: { userId: "u1", tenantId: "tenant-A", isAdmin: true },
  state: { tables: {} as Record<string, Record<string, unknown>[]> },
  net: {
    exchangeIgCode: vi.fn(),
    getLongLivedIgToken: vi.fn(),
    fetchIgProfile: vi.fn(),
    subscribeIgAccount: vi.fn(),
  },
}));
const { ctx, net } = h;
let tables: Record<string, Record<string, unknown>[]>;

vi.mock("@/lib/auth", () => ({ getUserContext: vi.fn(async () => h.ctx) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
vi.mock("@/lib/ig-login", async (orig) => ({ ...(await orig<typeof import("@/lib/ig-login")>()), ...h.net }));

import { GET } from "@/app/api/ig/oauth/callback/route";

const call = (qs: string, cookie: string | null = "ig_oauth_state=S1") =>
  GET(
    new NextRequest(`https://crm.example.com/api/ig/oauth/callback?${qs}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
const loc = (r: Response) => new URL(r.headers.get("location")!).search;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
  tables = h.state.tables = { ig_accounts: [] };
  ctx.isAdmin = true;
  ctx.tenantId = "tenant-A";
  net.exchangeIgCode.mockResolvedValue({ accessToken: "short", userId: "ig-1" });
  net.getLongLivedIgToken.mockResolvedValue({ accessToken: "long", expiresAt: "2027-01-17T00:00:00.000Z" });
  net.fetchIgProfile.mockResolvedValue({ userId: "ig-1", username: "mla_office", accountType: "BUSINESS" });
  net.subscribeIgAccount.mockResolvedValue(true);
  Object.values(net).forEach((m) => m.mockClear());
});

describe("F1 callback", () => {
  it("connects a professional account: stores username + token server-side and subscribes", async () => {
    const r = await call("code=abc%23_&state=S1");
    expect(loc(r)).toBe("?ig=connected&subscribed=1");
    expect(net.exchangeIgCode).toHaveBeenCalledWith("abc"); // Instagram's trailing "#_" is stripped
    expect(tables.ig_accounts).toHaveLength(1);
    expect(tables.ig_accounts[0]).toMatchObject({
      tenant_id: "tenant-A", ig_user_id: "ig-1", username: "mla_office", access_token: "long", status: "active", webhook_subscribed: true,
    });
  });
  it("refuses a personal account and saves nothing", async () => {
    net.fetchIgProfile.mockResolvedValue({ userId: "ig-1", username: "me", accountType: "PERSONAL" });
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=error&reason=personal");
    expect(tables.ig_accounts).toHaveLength(0);
  });
  it("a second tenant cannot attach an account another tenant already has", async () => {
    tables.ig_accounts.push({ id: "x", tenant_id: "tenant-B", ig_user_id: "ig-1", access_token: "theirs" });
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=error&reason=taken");
    expect(tables.ig_accounts).toHaveLength(1);
    expect(tables.ig_accounts[0]).toMatchObject({ tenant_id: "tenant-B", access_token: "theirs" });
  });
  it("reconnecting the same tenant's account updates it instead of duplicating", async () => {
    tables.ig_accounts.push({ id: "x", tenant_id: "tenant-A", ig_user_id: "ig-1", access_token: "old", status: "expired" });
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=1");
    expect(tables.ig_accounts).toHaveLength(1);
    expect(tables.ig_accounts[0]).toMatchObject({ access_token: "long", status: "active" });
  });
  it("still connects when the webhook subscription fails, and says so", async () => {
    net.subscribeIgAccount.mockRejectedValue(new Error("nope"));
    expect(loc(await call("code=abc&state=S1"))).toBe("?ig=connected&subscribed=0");
    expect(tables.ig_accounts[0].webhook_subscribed).toBe(false);
  });
  it("rejects a missing or mismatched CSRF state and never calls Instagram", async () => {
    expect(loc(await call("code=abc&state=OTHER"))).toBe("?ig=error&reason=state");
    expect(loc(await call("code=abc&state=S1", null))).toBe("?ig=error&reason=state");
    expect(loc(await call("state=S1"))).toBe("?ig=error&reason=state");
    expect(net.exchangeIgCode).not.toHaveBeenCalled();
  });
  it("handles the user denying consent", async () => {
    expect(loc(await call("error=access_denied&state=S1"))).toBe("?ig=error&reason=denied");
  });
  it("reports a failed exchange without saving or leaking the error", async () => {
    net.exchangeIgCode.mockRejectedValue(new Error("secret internals"));
    const r = await call("code=abc&state=S1");
    expect(loc(r)).toBe("?ig=error&reason=oauth");
    expect(tables.ig_accounts).toHaveLength(0);
  });
  it("is admin-only: a non-admin is sent away before any Instagram call", async () => {
    ctx.isAdmin = false;
    const r = await call("code=abc&state=S1");
    expect(new URL(r.headers.get("location")!).pathname).toBe("/dashboard");
    expect(net.exchangeIgCode).not.toHaveBeenCalled();
  });
});
