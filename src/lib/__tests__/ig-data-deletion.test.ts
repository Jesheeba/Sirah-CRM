import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { FakeAdmin } from "./fake-admin";
import { verifyIgSignedRequest } from "@/lib/ig-data-deletion";

type Rows = Record<string, Record<string, unknown>[]>;
const h = vi.hoisted(() => ({ state: { tables: {} as Rows } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => new FakeAdmin(h.state.tables) }));
import { POST as deauthorize } from "@/app/api/ig/deauthorize/route";
import { POST as dataDeletion } from "@/app/api/ig/data-deletion/route";

const SECRET = "ig-secret";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sign = (payload: object, secret = SECRET) => {
  const p = b64u(JSON.stringify(payload));
  return `${b64u(crypto.createHmac("sha256", secret).update(p).digest())}.${p}`;
};
const post = (handler: (r: NextRequest) => Promise<Response>, sr: string) =>
  handler(new NextRequest("https://crm.example.com/x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `signed_request=${encodeURIComponent(sr)}` }));

beforeEach(() => {
  process.env.IG_APP_SECRET = SECRET;
  process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
  h.state.tables = {
    ig_accounts: [
      { id: "a1", tenant_id: "T", ig_user_id: "ig-1", access_token: "tok", status: "active", webhook_subscribed: true },
      { id: "a2", tenant_id: "U", ig_user_id: "ig-2", access_token: "tok2", status: "active", webhook_subscribed: true },
    ],
    meta_deletion_requests: [],
  };
});

describe("F8 signed_request", () => {
  it("accepts a correctly signed request", () => {
    expect(verifyIgSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "ig-1", issued_at: 1 }))).toEqual({ user_id: "ig-1", issued_at: 1 });
  });
  it.each([
    ["wrong secret", sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }, "other")],
    ["tampered payload", sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }).replace(/\.(.)/, ".X")],
    ["wrong algorithm", sign({ algorithm: "none", user_id: "ig-1" })],
    ["missing user", sign({ algorithm: "HMAC-SHA256" })],
    ["garbage", "not-a-signed-request"],
    ["empty", ""],
  ])("rejects: %s", (_l, sr) => expect(verifyIgSignedRequest(sr)).toBeNull());
  it("rejects everything when the secret isn't configured", () => {
    expect(verifyIgSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }), "")).toBeNull();
  });
});

describe("F8 deauthorize callback", () => {
  it("stops using the account at once: token wiped, revoked; other accounts untouched", async () => {
    const r = await post(deauthorize, sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }));
    expect(r.status).toBe(200);
    expect(h.state.tables.ig_accounts[0]).toMatchObject({ status: "revoked", access_token: "", webhook_subscribed: false });
    expect(h.state.tables.ig_accounts[1]).toMatchObject({ status: "active", access_token: "tok2" });
  });
  it("a forged request changes nothing (400)", async () => {
    expect((await post(deauthorize, sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }, "forged"))).status).toBe(400);
    expect(h.state.tables.ig_accounts[0].status).toBe("active");
  });
});

describe("F8 data-deletion callback", () => {
  it("deletes the account's data and answers with Meta's {url, confirmation_code}", async () => {
    const r = await post(dataDeletion, sign({ algorithm: "HMAC-SHA256", user_id: "ig-1", issued_at: 1_763_424_000 }));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { url: string; confirmation_code: string };
    expect(j.url).toBe(`https://crm.example.com/data-deletion-status?code=${j.confirmation_code}`);
    expect(j.confirmation_code).toMatch(/^[0-9a-f]{32}$/);
    expect(h.state.tables.ig_accounts.map((a) => a.id)).toEqual(["a2"]);
    expect(h.state.tables.meta_deletion_requests[0]).toMatchObject({ facebook_uid: "ig:ig-1", code: j.confirmation_code, status: "completed" });
  });
  it("a forged request deletes nothing (400)", async () => {
    expect((await post(dataDeletion, sign({ algorithm: "HMAC-SHA256", user_id: "ig-1" }, "forged"))).status).toBe(400);
    expect(h.state.tables.ig_accounts).toHaveLength(2);
    expect(h.state.tables.meta_deletion_requests).toHaveLength(0);
  });
  it("the schema cascades: deleting the account removes its items, replies, audit and scoped rules", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const sql = ["0065_ig_interactions.sql", "0066_ig_replies.sql", "0067_ig_rules.sql"].map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
    expect(sql).toMatch(/ig_account_id\s+uuid not null references public\.ig_accounts\(id\) on delete cascade/);
    expect(sql).toMatch(/interaction_id\s+uuid not null references public\.ig_interactions\(id\) on delete cascade/);
    expect(sql).toMatch(/reply_id\s+uuid not null references public\.ig_replies\(id\) on delete cascade/);
    expect(sql).toMatch(/ig_account_id\s+uuid references public\.ig_accounts\(id\) on delete cascade/);
  });
});
