import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  WEBHOOK_MAX_BATCH,
  WEBHOOK_MAX_BYTES,
  WEBHOOK_RATE_LIMIT_PER_MIN,
  parseWebhookLead,
  timestampFresh,
  toLeadRecord,
  verifyWebhookSignature,
  type ParsedWebhookLead,
} from "@/lib/lead-webhook";

/**
 * Inbound lead webhook, contract v1. No session: allow-listed in middleware and authorised
 * solely by an HMAC-SHA256 signature over "<X-RD-Timestamp>.<raw body>" with the channel's
 * secret. Fails closed — there is no unauthenticated path.
 *
 * Order of checks: size → channel → signature → timestamp → rate limit → payload.
 * Re-delivering the same leadId updates the existing lead (idempotent), never duplicates.
 */

type Admin = ReturnType<typeof createAdminClient>;

interface Channel {
  id: string;
  tenant_id: string;
  secret: string;
  default_owner_id: string | null;
}

class HookError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE_HEADERS = { "Cache-Control": "no-store" } as const;

function errorResponse(requestId: string, e: HookError, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(
    { ok: false, apiVersion: "v1", requestId, error: { code: e.code, message: e.message } },
    { status: e.status, headers: { ...BASE_HEADERS, ...extra } },
  );
}

interface LeadOutcome {
  outcome: "created" | "updated";
  leadRef: string;
}

/** Create the lead, or update the one this leadId already produced. */
async function saveLead(admin: Admin, channel: Channel, parsed: ParsedWebhookLead): Promise<LeadOutcome> {
  const rec = toLeadRecord(parsed);

  // Two passes: if a concurrent delivery wins the insert (unique index), re-read and update.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: existing, error: findErr } = await admin
      .from("leads")
      .select("id, status, converted_at, converted_deal_id, converted_contact_id, custom_fields")
      .eq("tenant_id", channel.tenant_id)
      .is("deleted_at", null)
      .eq("custom_fields->>fb_leadgen_id", parsed.externalId)
      .maybeSingle();
    if (findErr) throw new HookError(500, "internal_error", "Could not save the lead.");

    if (existing) {
      if (existing.converted_at || existing.converted_deal_id || existing.converted_contact_id || existing.status === "converted") {
        throw new HookError(409, "already_converted", "This lead is already a live client; it was not changed.");
      }
      // Only fields that were actually sent overwrite; omitted ones keep their stored value.
      const patch: Record<string, unknown> = {
        phone: rec.phone,
        custom_fields: { ...((existing.custom_fields as Record<string, string> | null) ?? {}), ...rec.custom_fields },
      };
      if (rec.first_name) {
        patch.first_name = rec.first_name;
        patch.last_name = rec.last_name;
      }
      const { error } = await admin.from("leads").update(patch).eq("id", existing.id).eq("tenant_id", channel.tenant_id);
      if (error) throw new HookError(500, "internal_error", "Could not save the lead.");
      return { outcome: "updated", leadRef: existing.id as string };
    }

    const { data: created, error } = await admin
      .from("leads")
      .insert({
        tenant_id: channel.tenant_id,
        first_name: rec.first_name,
        last_name: rec.last_name,
        phone: rec.phone,
        source: rec.source,
        status: "new",
        score: 0,
        owner_id: channel.default_owner_id,
        custom_fields: rec.custom_fields,
      })
      .select("id")
      .single();
    if (!error && created) return { outcome: "created", leadRef: created.id as string };
    if (error?.code === "23505") continue; // lost a race to a concurrent delivery — update it instead
    throw new HookError(500, "internal_error", "Could not save the lead.");
  }
  throw new HookError(500, "internal_error", "Could not save the lead.");
}

async function logDelivery(
  admin: Admin,
  channelId: string,
  requestId: string,
  status: number,
  errorCode: string | null,
  counts: { received: number; created: number; updated: number; failed: number },
) {
  try {
    await admin.from("lead_webhook_deliveries").insert({
      channel_id: channelId,
      request_id: requestId,
      http_status: status,
      error_code: errorCode,
      ...counts,
    });
  } catch {
    // Logging must never change the response.
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ channel: string }> }) {
  const requestId = randomUUID();
  const { channel: channelName } = await ctx.params;
  const none = { received: 0, created: 0, updated: 0, failed: 0 };

  try {
    // 1. Size — checked from the header first so an oversized body is never buffered.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > WEBHOOK_MAX_BYTES) {
      return errorResponse(requestId, new HookError(413, "payload_too_large", "Body is over 1 MB."));
    }
    const raw = Buffer.from(await req.arrayBuffer());
    if (raw.length > WEBHOOK_MAX_BYTES) {
      return errorResponse(requestId, new HookError(413, "payload_too_large", "Body is over 1 MB."));
    }

    // 2. Channel → tenant + secret. Disabled, unknown and suspended-tenant all look alike.
    const admin = createAdminClient();
    const { data: ch } = await admin
      .from("lead_webhook_channels")
      .select("id, tenant_id, secret, default_owner_id, is_enabled")
      .eq("channel", channelName)
      .maybeSingle();
    const { data: tenant } = ch
      ? await admin.from("tenants").select("status, deleted_at").eq("id", ch.tenant_id).maybeSingle()
      : { data: null };
    if (!ch || !ch.is_enabled || !tenant || tenant.deleted_at || tenant.status !== "active") {
      return errorResponse(requestId, new HookError(401, "unknown_channel", "Unknown channel."));
    }
    const channel = ch as unknown as Channel;

    // 3. Signature, then freshness (a stale-but-correctly-signed request is a clock problem, not an attack).
    const ts = req.headers.get("x-rd-timestamp");
    if (!verifyWebhookSignature(channel.secret, ts, req.headers.get("x-rd-signature"), raw)) {
      await logDelivery(admin, channel.id, requestId, 401, "invalid_signature", none);
      return errorResponse(requestId, new HookError(401, "invalid_signature", "Signature check failed."));
    }
    if (!timestampFresh(ts as string, Math.floor(Date.now() / 1000))) {
      await logDelivery(admin, channel.id, requestId, 408, "stale_timestamp", none);
      return errorResponse(requestId, new HookError(408, "stale_timestamp", "X-RD-Timestamp is more than 5 minutes from server time."));
    }

    // 4. Rate limit (fails closed if the limiter itself errors).
    const { data: allowed, error: rateErr } = await admin.rpc("lead_webhook_hit", {
      p_channel: channel.id,
      p_limit: WEBHOOK_RATE_LIMIT_PER_MIN,
    });
    if (rateErr) throw new HookError(500, "internal_error", "Could not process the request.");
    if (!allowed) {
      await logDelivery(admin, channel.id, requestId, 429, "rate_limited", none);
      return errorResponse(requestId, new HookError(429, "rate_limited", "Too many requests. Retry after the Retry-After delay."), {
        "Retry-After": "60",
      });
    }

    // 5. Payload: one lead, or { leads: [...] } of up to 100.
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      await logDelivery(admin, channel.id, requestId, 400, "invalid_json", none);
      return errorResponse(requestId, new HookError(400, "invalid_json", "Body is not valid JSON."));
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      await logDelivery(admin, channel.id, requestId, 400, "invalid_json", none);
      return errorResponse(requestId, new HookError(400, "invalid_json", "Body must be a JSON object."));
    }

    const obj = body as Record<string, unknown>;
    const isBatch = Array.isArray(obj.leads);
    const items: unknown[] = isBatch ? (obj.leads as unknown[]) : [obj];
    if (isBatch && (items.length === 0 || items.length > WEBHOOK_MAX_BATCH)) {
      const e = new HookError(400, "invalid_batch", `leads must hold 1 to ${WEBHOOK_MAX_BATCH} items.`);
      await logDelivery(admin, channel.id, requestId, 400, e.code, none);
      return errorResponse(requestId, e);
    }

    // 6. Process each lead; one bad item never blocks the others.
    const results: Array<Record<string, unknown>> = [];
    let created = 0;
    let updated = 0;
    let failed = 0;
    let firstError: HookError | null = null;
    let missing: string[] = [];

    for (const item of items) {
      let leadId: string | undefined;
      try {
        if (typeof item !== "object" || item === null || Array.isArray(item)) {
          throw new HookError(400, "invalid_json", "Each lead must be a JSON object.");
        }
        const parsed = parseWebhookLead(item as Record<string, unknown>);
        if (!parsed.ok) throw new HookError(400, parsed.code, parsed.message);
        leadId = parsed.lead.externalId;
        const saved = await saveLead(admin, channel, parsed.lead);
        if (saved.outcome === "created") created++;
        else updated++;
        missing = parsed.lead.missingFields;
        results.push({ leadId, ok: true, outcome: saved.outcome, leadRef: saved.leadRef, missingFields: missing });
        if (!isBatch) {
          const status = saved.outcome === "created" ? 201 : 200;
          await logDelivery(admin, channel.id, requestId, status, null, { received: 1, created, updated, failed });
          return NextResponse.json(
            { ok: true, apiVersion: "v1", requestId, outcome: saved.outcome, leadRef: saved.leadRef, missingFields: missing },
            { status, headers: BASE_HEADERS },
          );
        }
      } catch (e) {
        const he = e instanceof HookError ? e : new HookError(500, "internal_error", "Could not save the lead.");
        failed++;
        firstError ??= he;
        results.push({ ...(leadId ? { leadId } : {}), ok: false, error: { code: he.code, message: he.message } });
      }
    }

    if (!isBatch) {
      // A single lead that did not succeed: answer with its own status and code.
      const e = firstError ?? new HookError(500, "internal_error", "Could not save the lead.");
      await logDelivery(admin, channel.id, requestId, e.status, e.code, { received: 1, created, updated, failed });
      return errorResponse(requestId, e);
    }

    const status = failed === 0 ? 200 : 207;
    await logDelivery(admin, channel.id, requestId, status, failed ? "partial" : null, {
      received: items.length,
      created,
      updated,
      failed,
    });
    return NextResponse.json(
      {
        ok: failed === 0,
        apiVersion: "v1",
        requestId,
        summary: { received: items.length, created, updated, failed },
        results,
      },
      { status, headers: BASE_HEADERS },
    );
  } catch (e) {
    const he = e instanceof HookError ? e : new HookError(500, "internal_error", "Could not process the request.");
    return errorResponse(requestId, he);
  }
}
