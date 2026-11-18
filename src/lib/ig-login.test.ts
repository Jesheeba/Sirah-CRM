import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IG_SCOPES,
  buildIgAuthUrl,
  expiresAtFrom,
  isProfessionalAccount,
  needsRefresh,
  parseShortToken,
} from "./ig-login";
import { processIgTokenRefresh } from "./ig-token-refresh";
import { FakeAdmin } from "./__tests__/fake-admin";

const DAY = 86_400_000;
const NOW = new Date("2026-11-18T00:00:00Z");

describe("F1 connect: account type and scopes", () => {
  it("accepts Business and Creator accounts, refuses personal / unknown", () => {
    expect(isProfessionalAccount("BUSINESS")).toBe(true);
    expect(isProfessionalAccount("media_creator")).toBe(true);
    expect(isProfessionalAccount("PERSONAL")).toBe(false);
    expect(isProfessionalAccount(null)).toBe(false);
    expect(isProfessionalAccount("")).toBe(false);
  });
  it("requests exactly the three instagram_business_* permissions", () => {
    expect(IG_SCOPES.split(",").sort()).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_comments",
      "instagram_business_manage_messages",
    ]);
  });
  it("auth URL carries the client id, redirect, scope and state", () => {
    process.env.IG_APP_ID = "123";
    process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
    const u = new URL(buildIgAuthUrl("state-1"));
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("123");
    expect(u.searchParams.get("state")).toBe("state-1");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://crm.example.com/api/ig/oauth/callback");
    expect(u.searchParams.get("scope")).toBe(IG_SCOPES);
  });
});

describe("F1 connect: code-exchange response shapes", () => {
  it("reads both the flat and the {data:[…]} shapes", () => {
    expect(parseShortToken({ access_token: "t1", user_id: 99 })).toEqual({ accessToken: "t1", userId: "99" });
    expect(parseShortToken({ data: [{ access_token: "t2", user_id: "7" }] })).toEqual({ accessToken: "t2", userId: "7" });
  });
  it("returns null for anything without a token", () => {
    expect(parseShortToken({})).toBeNull();
    expect(parseShortToken(null)).toBeNull();
    expect(parseShortToken({ data: [] })).toBeNull();
    expect(parseShortToken({ access_token: "" })).toBeNull();
  });
});

describe("F1 token lifecycle: refresh window (mocked clock)", () => {
  it("is false when more than 10 days remain, true inside the window", () => {
    expect(needsRefresh(new Date(NOW.getTime() + 30 * DAY).toISOString(), NOW)).toBe(false);
    expect(needsRefresh(new Date(NOW.getTime() + 11 * DAY).toISOString(), NOW)).toBe(false);
    expect(needsRefresh(new Date(NOW.getTime() + 9 * DAY).toISOString(), NOW)).toBe(true);
  });
  it("treats missing, invalid and past expiry as needing attention", () => {
    expect(needsRefresh(null, NOW)).toBe(true);
    expect(needsRefresh("not-a-date", NOW)).toBe(true);
    expect(needsRefresh(new Date(NOW.getTime() - DAY).toISOString(), NOW)).toBe(true);
  });
  it("expiresAtFrom adds the lifetime to now", () => {
    expect(expiresAtFrom(60 * 86400, NOW)).toBe(new Date(NOW.getTime() + 60 * DAY).toISOString());
  });
});

describe("F1 token lifecycle: daily refresh job", () => {
  const acc = (id: string, daysLeft: number | null, status = "active") => ({
    id,
    access_token: `tok-${id}`,
    status,
    token_expires_at: daysLeft === null ? null : new Date(NOW.getTime() + daysLeft * DAY).toISOString(),
  });
  const run = async (rows: ReturnType<typeof acc>[], refresh: (t: string) => Promise<{ accessToken: string; expiresAt: string }>) => {
    const tables = { ig_accounts: rows as Record<string, unknown>[] };
    const res = await processIgTokenRefresh(new FakeAdmin(tables) as unknown as SupabaseClient, { refresh, now: NOW });
    return { res, rows: tables.ig_accounts };
  };

  it("refreshes only tokens inside the window and stores the new token + expiry", async () => {
    const refresh = vi.fn().mockResolvedValue({ accessToken: "new", expiresAt: "2027-01-01T00:00:00.000Z" });
    const { res, rows } = await run([acc("a", 5), acc("b", 40)], refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("tok-a");
    expect(res).toEqual({ checked: 1, refreshed: 1, expired: 0, failed: 0 });
    expect(rows.find((r) => r.id === "a")).toMatchObject({ access_token: "new", token_expires_at: "2027-01-01T00:00:00.000Z" });
    expect(rows.find((r) => r.id === "b")?.access_token).toBe("tok-b");
  });
  it("marks a token already past expiry as expired without calling Instagram", async () => {
    const refresh = vi.fn();
    const { res, rows } = await run([acc("a", -2)], refresh);
    expect(refresh).not.toHaveBeenCalled();
    expect(res.expired).toBe(1);
    expect(rows[0].status).toBe("expired");
  });
  it("a failed refresh inside the window leaves the account active for the next tick", async () => {
    const { res, rows } = await run([acc("a", 3)], vi.fn().mockRejectedValue(new Error("boom")));
    expect(res).toEqual({ checked: 1, refreshed: 0, expired: 0, failed: 1 });
    expect(rows[0].status).toBe("active");
    expect(rows[0].access_token).toBe("tok-a");
  });
  it("ignores revoked accounts and tolerates an empty table", async () => {
    const refresh = vi.fn();
    expect((await run([acc("a", 1, "revoked")], refresh)).res.checked).toBe(0);
    expect((await run([], refresh)).res).toEqual({ checked: 0, refreshed: 0, expired: 0, failed: 0 });
  });
});

describe("F1 security: the token is never exposed to client roles", () => {
  const sql = readFileSync("supabase/migrations/0064_ig_accounts.sql", "utf8");
  it("revokes client access and grants only non-secret columns", () => {
    expect(sql).toMatch(/revoke all on public\.ig_accounts from authenticated/);
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.ig_accounts to authenticated/)![1];
    expect(grant).not.toMatch(/access_token/);
    expect(grant).toMatch(/username/);
  });
  it("one Instagram account can belong to only one tenant (unique ig_user_id)", () => {
    expect(sql).toMatch(/ig_user_id\s+text not null unique/);
  });
});
