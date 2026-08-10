/**
 * Meta Data Deletion — signed_request verification + the actual deletion logic.
 *
 * Server-only. Verification is used by the callback route (src/app/api/meta/data-deletion
 * /route.ts); the deletion logic runs asynchronously from the workflow cron tick
 * (src/app/api/workflows/tick/route.ts), never inline in the callback response.
 *
 * Scope, as decided when this was implemented: this deletes data WE OBTAINED FROM META
 * about the Facebook user who revoked access — their WhatsApp/Lead-Ads connection tokens,
 * the Page connections themselves, unconverted leads ingested from their Pages, and
 * WhatsApp messages on the tenant(s) whose WhatsApp they connected. It does NOT touch
 * contacts/accounts/deals that were converted from a Meta lead (those are now the
 * tenant's own CRM records) — those are only de-identified (source cleared) so no Meta
 * linkage remains on them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";

if (typeof window !== "undefined") {
  throw new Error("lib/meta-data-deletion.ts is server-only and must not be imported in the browser.");
}

// ─── signed_request verification ────────────────────────────────────────────────

export interface DeletionPayload {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
  expires?: number;
}

export type MatchedSecret = "META_APP_SECRET" | "FB_APP_SECRET";

export interface VerifiedSignedRequest {
  payload: DeletionPayload;
  /** Which app secret verified the signature — logged for traceability, since this app
   *  registers two Meta apps (Lead Ads and WhatsApp Embedded Signup) and either could be
   *  the one with the Data Deletion Callback URL configured in the Meta dashboard. */
  matchedSecret: MatchedSecret;
}

function base64urlToBuffer(str: string): Buffer {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function signatureMatches(sig: Buffer, payloadPart: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  return sig.length === expected.length && timingSafeEqual(sig, expected);
}

/**
 * Verify Meta's signed_request per the documented algorithm exactly:
 *   split on "." -> [sig, payload] -> base64url-decode both -> HMAC-SHA256(payload) with
 *   the app secret -> compare to the decoded signature with timingSafeEqual.
 * Tries META_APP_SECRET first, then FB_APP_SECRET — whichever produces a valid signature
 * wins. Returns null on ANY verification failure; callers must never process an
 * unverified request.
 */
export function verifySignedRequest(signedRequest: string): VerifiedSignedRequest | null {
  const dot = signedRequest.indexOf(".");
  if (dot === -1) return null;

  const encodedSig = signedRequest.slice(0, dot);
  const payloadPart = signedRequest.slice(dot + 1);
  if (!encodedSig || !payloadPart) return null;

  const sigBuf = base64urlToBuffer(encodedSig);

  const candidates: Array<[MatchedSecret, string | undefined]> = [
    ["META_APP_SECRET", process.env.META_APP_SECRET],
    ["FB_APP_SECRET", process.env.FB_APP_SECRET],
  ];

  let matchedSecret: MatchedSecret | null = null;
  for (const [name, secret] of candidates) {
    if (secret && signatureMatches(sigBuf, payloadPart, secret)) {
      matchedSecret = name;
      break;
    }
  }
  if (!matchedSecret) return null;

  let payload: DeletionPayload;
  try {
    payload = JSON.parse(base64urlToBuffer(payloadPart).toString("utf8")) as DeletionPayload;
  } catch {
    return null;
  }

  if (payload.algorithm !== "HMAC-SHA256") return null;
  if (!payload.user_id) return null;

  return { payload, matchedSecret };
}

// ─── deletion processing (async, run from the cron tick) ───────────────────────

export interface DeletionSummary {
  counts: Record<string, number>;
  notes: string | null;
}

/**
 * Delete/anonymize everything obtained from Meta for one Facebook user id. Idempotent —
 * every step is a delete-if-exists or set-to-null, so replaying this against a user who
 * was already processed (or partially processed) touches zero rows the second time and
 * never errors.
 */
export async function deleteMetaUserData(
  admin: SupabaseClient,
  facebookUid: string,
): Promise<DeletionSummary> {
  const counts: Record<string, number> = {};

  const [{ data: waRows }, { data: pageRows }] = await Promise.all([
    admin.from("integration_settings").select("id, tenant_id").eq("channel", "whatsapp").eq("fb_user_id", facebookUid),
    admin.from("meta_lead_pages").select("id, tenant_id, page_id").eq("fb_user_id", facebookUid),
  ]);

  const waTenantIds = [...new Set((waRows ?? []).map((r: { tenant_id: string }) => r.tenant_id))];
  const pageIds = (pageRows ?? []).map((r: { page_id: string }) => r.page_id);

  if (!waRows?.length && !pageRows?.length) {
    return {
      counts: {},
      notes:
        "No matching records found for this Facebook user id — either no connection was ever " +
        "made for it, or it predates fb_user_id tracking on this connection. No fuzzy matching " +
        "was attempted.",
    };
  }

  // WhatsApp message content, for every tenant this user connected WhatsApp for.
  if (waTenantIds.length) {
    const { count } = await admin
      .from("communications")
      .select("id", { count: "exact", head: true })
      .eq("channel", "whatsapp")
      .in("tenant_id", waTenantIds);
    counts.whatsapp_communications_deleted = count ?? 0;
    if (count) {
      await admin.from("communications").delete().eq("channel", "whatsapp").in("tenant_id", waTenantIds);
    }
  }

  // Disconnect the WhatsApp integration: null every credential/identifier, keep the row
  // (it's the tenant's channel config slot — same shape a manual disconnect leaves).
  if (waRows?.length) {
    await admin
      .from("integration_settings")
      .update({
        is_enabled: false,
        access_token: null,
        phone_id: null,
        business_account_id: null,
        app_secret: null,
        verify_token: null,
        webhook_token: null,
        fb_user_id: null,
        secret_set: false,
        secret_last4: null,
        app_secret_set: false,
      })
      .eq("channel", "whatsapp")
      .eq("fb_user_id", facebookUid);
    counts.whatsapp_connections_disconnected = waRows.length;
  }

  // Lead Ads: leads ingested via this user's Pages. Unconverted -> delete outright.
  // Converted -> out of scope (now the tenant's own CRM record); only strip the
  // Meta-origin identifier (source) so no linkage remains.
  if (pageIds.length) {
    const { data: events } = await admin
      .from("meta_lead_events")
      .select("id, lead_id")
      .in("page_id", pageIds);

    const leadIds = [
      ...new Set((events ?? []).map((e: { lead_id: string | null }) => e.lead_id).filter((id: string | null): id is string => !!id)),
    ];

    if (leadIds.length) {
      const { data: leadRows } = await admin.from("leads").select("id, converted_at").in("id", leadIds);
      const unconvertedIds = (leadRows ?? []).filter((l: { converted_at: string | null }) => !l.converted_at).map((l: { id: string }) => l.id);
      const convertedIds = (leadRows ?? []).filter((l: { converted_at: string | null }) => l.converted_at).map((l: { id: string }) => l.id);

      if (unconvertedIds.length) {
        await admin.from("leads").delete().in("id", unconvertedIds);
        counts.unconverted_leads_deleted = unconvertedIds.length;
      }
      if (convertedIds.length) {
        await admin.from("leads").update({ source: null }).in("id", convertedIds);
        counts.converted_leads_deidentified = convertedIds.length;
      }
    }

    // The ingestion/idempotency log itself — our data, not the tenant's — and the
    // linkage a converted lead would otherwise still carry back to the leadgen event.
    if (events?.length) {
      await admin.from("meta_lead_events").delete().in("page_id", pageIds);
      counts.meta_lead_events_deleted = events.length;
    }
  }

  if (pageRows?.length) {
    await admin.from("meta_lead_pages").delete().eq("fb_user_id", facebookUid);
    counts.meta_lead_pages_deleted = pageRows.length;
  }

  return { counts, notes: null };
}

const BATCH_SIZE = 10;

export interface DeletionProcessResult {
  processed: number;
  completed: number;
  failed: number;
}

/**
 * Picks up pending meta_deletion_requests and processes them. Called from the workflow
 * cron tick (every minute) — the callback route only ever enqueues, never deletes inline.
 * No auto-retry on failure by design: a 'failed' row stays failed for manual follow-up
 * rather than silently retrying compliance-sensitive deletions on a timer.
 */
export async function processMetaDeletionRequests(admin: SupabaseClient): Promise<DeletionProcessResult> {
  const { data: batch, error } = await admin
    .from("meta_deletion_requests")
    .select("id, facebook_uid")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error || !batch?.length) return { processed: 0, completed: 0, failed: 0 };

  const ids = batch.map((r: { id: string }) => r.id);
  await admin.from("meta_deletion_requests").update({ status: "processing" }).in("id", ids);

  let completed = 0;
  let failed = 0;

  for (const row of batch as Array<{ id: string; facebook_uid: string }>) {
    try {
      const summary = await deleteMetaUserData(admin, row.facebook_uid);
      await admin
        .from("meta_deletion_requests")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          deleted_summary: summary.counts,
          notes: summary.notes,
        })
        .eq("id", row.id);
      completed++;
    } catch (e) {
      await admin
        .from("meta_deletion_requests")
        .update({
          status: "failed",
          notes: e instanceof Error ? e.message : "Unknown error during deletion.",
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return { processed: batch.length, completed, failed };
}
