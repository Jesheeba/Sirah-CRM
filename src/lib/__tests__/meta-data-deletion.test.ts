import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  verifySignedRequest,
  deleteMetaUserData,
  processMetaDeletionRequests,
} from "@/lib/meta-data-deletion";
import { FakeAdmin } from "./fake-admin";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function makeSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const payloadPart = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(createHmac("sha256", secret).update(payloadPart).digest());
  return `${sig}.${payloadPart}`;
}

const VALID_PAYLOAD = { algorithm: "HMAC-SHA256", issued_at: 1_700_000_000, user_id: "fb-user-1" };

describe("verifySignedRequest", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.META_APP_SECRET = "lead-ads-secret";
    process.env.FB_APP_SECRET = "whatsapp-secret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("verifies a valid signature using META_APP_SECRET", () => {
    const req = makeSignedRequest(VALID_PAYLOAD, "lead-ads-secret");
    const result = verifySignedRequest(req);
    expect(result).not.toBeNull();
    expect(result?.matchedSecret).toBe("META_APP_SECRET");
    expect(result?.payload.user_id).toBe("fb-user-1");
  });

  it("falls back to FB_APP_SECRET when META_APP_SECRET doesn't match", () => {
    const req = makeSignedRequest(VALID_PAYLOAD, "whatsapp-secret");
    const result = verifySignedRequest(req);
    expect(result).not.toBeNull();
    expect(result?.matchedSecret).toBe("FB_APP_SECRET");
  });

  it("rejects a tampered signature", () => {
    const req = makeSignedRequest(VALID_PAYLOAD, "lead-ads-secret");
    const [, payloadPart] = req.split(".");
    const tampered = `${base64url(Buffer.from("not-the-real-signature-bytes!!"))}.${payloadPart}`;
    expect(verifySignedRequest(tampered)).toBeNull();
  });

  it("rejects a signature from a secret the app doesn't have", () => {
    const req = makeSignedRequest(VALID_PAYLOAD, "some-other-app-secret");
    expect(verifySignedRequest(req)).toBeNull();
  });

  it("rejects a malformed request with no '.' separator", () => {
    expect(verifySignedRequest("not-a-signed-request-at-all")).toBeNull();
  });

  it("rejects the wrong algorithm", () => {
    const req = makeSignedRequest({ ...VALID_PAYLOAD, algorithm: "SHA-1" }, "lead-ads-secret");
    expect(verifySignedRequest(req)).toBeNull();
  });

  it("rejects a payload missing user_id", () => {
    const req = makeSignedRequest({ algorithm: "HMAC-SHA256", issued_at: 1_700_000_000 }, "lead-ads-secret");
    expect(verifySignedRequest(req)).toBeNull();
  });
});

describe("deleteMetaUserData", () => {
  function seed() {
    const tables: Record<string, Record<string, unknown>[]> = {
      integration_settings: [
        {
          id: "is-1",
          tenant_id: "tenant-a",
          channel: "whatsapp",
          fb_user_id: "fb-user-1",
          access_token: "secret-token",
          is_enabled: true,
          secret_set: true,
        },
        // A different tenant's WhatsApp connection — must never be touched.
        { id: "is-2", tenant_id: "tenant-b", channel: "whatsapp", fb_user_id: "fb-user-OTHER", is_enabled: true },
      ],
      meta_lead_pages: [
        { id: "pg-1", tenant_id: "tenant-a", page_id: "page-1", fb_user_id: "fb-user-1" },
      ],
      meta_lead_events: [
        { id: "ev-1", page_id: "page-1", lead_id: "lead-unconverted" },
        { id: "ev-2", page_id: "page-1", lead_id: "lead-converted" },
      ],
      leads: [
        { id: "lead-unconverted", tenant_id: "tenant-a", source: "Facebook Lead Ads", converted_at: null },
        { id: "lead-converted", tenant_id: "tenant-a", source: "Facebook Lead Ads", converted_at: "2026-01-01T00:00:00Z" },
        // Untouched control row for a different tenant.
        { id: "lead-other", tenant_id: "tenant-b", source: "manual", converted_at: null },
      ],
      communications: [
        { id: "comm-1", tenant_id: "tenant-a", channel: "whatsapp" },
        { id: "comm-2", tenant_id: "tenant-a", channel: "email" }, // must survive — wrong channel
        { id: "comm-3", tenant_id: "tenant-b", channel: "whatsapp" }, // must survive — wrong tenant
      ],
      meta_deletion_requests: [],
    };
    return { tables, admin: new FakeAdmin(tables) as unknown as SupabaseClient };
  }

  it("reports no matching records honestly, without fuzzy matching", async () => {
    const { admin } = seed();
    const summary = await deleteMetaUserData(admin, "fb-user-NEVER-CONNECTED");
    expect(summary.counts).toEqual({});
    expect(summary.notes).toMatch(/no matching records/i);
  });

  it("deletes/anonymizes exactly the scoped data for the matched Facebook user", async () => {
    const { admin, tables } = seed();
    const summary = await deleteMetaUserData(admin, "fb-user-1");

    expect(summary.counts).toMatchObject({
      whatsapp_communications_deleted: 1,
      whatsapp_connections_disconnected: 1,
      unconverted_leads_deleted: 1,
      converted_leads_deidentified: 1,
      meta_lead_events_deleted: 2,
      meta_lead_pages_deleted: 1,
    });

    // In scope, gone/anonymized:
    expect(tables.leads.find((l) => l.id === "lead-unconverted")).toBeUndefined();
    expect(tables.communications.find((c) => c.id === "comm-1")).toBeUndefined();
    expect(tables.meta_lead_pages).toHaveLength(0);
    expect(tables.meta_lead_events).toHaveLength(0);

    const connection = tables.integration_settings.find((r) => r.id === "is-1")!;
    expect(connection.access_token).toBeNull();
    expect(connection.is_enabled).toBe(false);
    expect(connection.fb_user_id).toBeNull();

    // Converted lead: NOT deleted, only de-identified.
    const converted = tables.leads.find((l) => l.id === "lead-converted")!;
    expect(converted).toBeDefined();
    expect(converted.source).toBeNull();

    // Out of scope, untouched:
    expect(tables.leads.find((l) => l.id === "lead-other")).toBeDefined();
    expect(tables.communications.find((c) => c.id === "comm-2")).toBeDefined();
    expect(tables.communications.find((c) => c.id === "comm-3")).toBeDefined();
    const otherTenant = tables.integration_settings.find((r) => r.id === "is-2")!;
    expect(otherTenant.is_enabled).toBe(true);
    expect(otherTenant.fb_user_id).toBe("fb-user-OTHER");
  });

  it("is idempotent — replaying against already-processed data touches nothing and never throws", async () => {
    const { admin } = seed();
    await deleteMetaUserData(admin, "fb-user-1");
    const second = await deleteMetaUserData(admin, "fb-user-1");
    expect(second.counts).toEqual({});
    expect(second.notes).toMatch(/no matching records/i);
  });
});

describe("processMetaDeletionRequests (full request lifecycle)", () => {
  it("takes a pending request through processing to completed, with the summary recorded", async () => {
    const tables: Record<string, Record<string, unknown>[]> = {
      integration_settings: [
        { id: "is-1", tenant_id: "tenant-a", channel: "whatsapp", fb_user_id: "fb-user-1", access_token: "x", is_enabled: true },
      ],
      meta_lead_pages: [],
      meta_lead_events: [],
      leads: [],
      communications: [{ id: "comm-1", tenant_id: "tenant-a", channel: "whatsapp" }],
      meta_deletion_requests: [
        { id: "req-1", facebook_uid: "fb-user-1", code: "abc123", status: "pending", requested_at: "2026-01-01T00:00:00Z" },
      ],
    };
    const admin = new FakeAdmin(tables) as unknown as SupabaseClient;

    const result = await processMetaDeletionRequests(admin);

    expect(result).toEqual({ processed: 1, completed: 1, failed: 0 });
    const row = tables.meta_deletion_requests[0];
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBeTruthy();
    expect((row.deleted_summary as Record<string, number>).whatsapp_communications_deleted).toBe(1);

    // Status-page lookup by code (what /data-deletion-status?code= does) now reflects COMPLETED.
    const { data: statusLookup } = await admin
      .from("meta_deletion_requests")
      .select("status, completed_at")
      .eq("code", "abc123")
      .maybeSingle();
    expect((statusLookup as { status: string }).status).toBe("completed");
  });

  it("does nothing when there are no pending requests", async () => {
    const tables: Record<string, Record<string, unknown>[]> = { meta_deletion_requests: [] };
    const admin = new FakeAdmin(tables) as unknown as SupabaseClient;
    expect(await processMetaDeletionRequests(admin)).toEqual({ processed: 0, completed: 0, failed: 0 });
  });
});
