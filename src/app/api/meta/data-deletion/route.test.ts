import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { FakeAdmin } from "@/lib/__tests__/fake-admin";

const state = vi.hoisted(() => ({ admin: null as unknown as InstanceType<typeof import("@/lib/__tests__/fake-admin").FakeAdmin> }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
}));

// Imported after the mock so the route picks up the mocked admin client.
const { POST } = await import("./route");

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function makeSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const payloadPart = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(createHmac("sha256", secret).update(payloadPart).digest());
  return `${sig}.${payloadPart}`;
}
function formRequest(signedRequest: string): Request {
  return new Request("http://localhost/api/meta/data-deletion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ signed_request: signedRequest }).toString(),
  });
}

describe("POST /api/meta/data-deletion", () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = "lead-ads-secret";
    process.env.FB_APP_SECRET = "whatsapp-secret";
    process.env.NEXT_PUBLIC_APP_URL = "https://crm.example.com";
    state.admin = new FakeAdmin({ meta_deletion_requests: [] }) as never;
  });

  it("returns exactly {url, confirmation_code} and enqueues rather than processing inline", async () => {
    const payload = { algorithm: "HMAC-SHA256", issued_at: 1_700_000_000, user_id: "fb-user-42" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formRequest(makeSignedRequest(payload, "lead-ads-secret")) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Object.keys(json).sort()).toEqual(["confirmation_code", "url"]);
    expect(json.url).toBe(`https://crm.example.com/data-deletion-status?code=${json.confirmation_code}`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (state.admin as any).tables.meta_deletion_requests;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending"); // not deleted inline — the cron tick processes it
  });

  it("rejects an unverified request with 400 and records nothing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formRequest("garbage.garbage") as any);
    expect(res.status).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((state.admin as any).tables.meta_deletion_requests).toHaveLength(0);
  });

  it("is idempotent: replaying the identical signed_request returns the same code, no duplicate row", async () => {
    const payload = { algorithm: "HMAC-SHA256", issued_at: 1_700_000_111, user_id: "fb-user-99" };
    const signed = makeSignedRequest(payload, "lead-ads-secret");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await (await POST(formRequest(signed) as any)).json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await (await POST(formRequest(signed) as any)).json();

    expect(second.confirmation_code).toBe(first.confirmation_code);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((state.admin as any).tables.meta_deletion_requests).toHaveLength(1);
  });
});
