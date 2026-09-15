import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, isOptOutMessage } from "@/lib/whatsapp";
import { KNOWN_TEMPLATE_STATUSES } from "@/lib/whatsapp-templates";

// Node.js runtime required for the `crypto` module (HMAC verification).
export const runtime = "nodejs";

// Meta Cloud API delivery status → communications.status
const STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "opened",
  failed: "failed",
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode      = params.get("hub.mode");
  const token     = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode !== "subscribe" || !token || !verifyToken || token !== verifyToken) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge ?? "", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: NextRequest) {
  // Reject immediately if the platform app secret is absent — nothing can be verified.
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Buffer raw body FIRST — required for HMAC before JSON.parse consumes it.
  const rawBody = await req.text();

  // Validate HMAC-SHA256 signature before touching the payload or hitting the DB.
  const sig     = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const sigBuf  = Buffer.from(sig);
  const expBuf  = Buffer.from(expected);
  // timingSafeEqual requires equal-length buffers; length mismatch → invalid sig.
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    let parsed: MetaWebhookPayload;
    try {
      parsed = JSON.parse(rawBody) as MetaWebhookPayload;
    } catch {
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();

    // ── Template status / quality updates ─────────────────────────────────────
    // These arrive on a WABA-scoped entry (entry.id = business_account_id), not the
    // phone-number-scoped entry the rest of this handler assumes — handle them in
    // their own pass over every entry/change rather than just entry[0].changes[0].
    for (const entry of parsed.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === "message_template_status_update" || change.field === "message_template_quality_update") {
          await handleTemplateEvent(admin, entry.id, change.field, change.value as unknown as TemplateEventValue);
        }
      }
    }

    // phone_number_id is how we route to the correct tenant for message/status events.
    const phoneNumberId =
      parsed.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!phoneNumberId) {
      return NextResponse.json({ received: true });
    }

    // Resolve tenant by phone_id — app_secret verified globally above, not needed per-row.
    // Deterministic ordering: if more than one enabled row ever shares a phone_id again
    // (it has happened — two tenants' WABAs ended up on the same phone_id during earlier
    // Embedded Signup testing), always take the oldest connection rather than whatever
    // order Postgres happens to return, and log it loudly so it gets noticed and fixed
    // rather than silently resolving to a possibly-wrong tenant.
    const { data: settings, error: settingsErr } = await admin
      .from("integration_settings")
      .select("tenant_id")
      .eq("phone_id", phoneNumberId)
      .eq("channel", "whatsapp")
      .eq("is_enabled", true)
      .order("created_at", { ascending: true })
      .limit(1);

    if (settingsErr) {
      console.error("[WA Webhook] tenant lookup failed:", settingsErr.message);
      return NextResponse.json({ received: true });
    }

    if ((settings?.length ?? 0) > 1) {
      console.warn(
        `[WA Webhook] ALERT: phone_id ${phoneNumberId} matches ${settings!.length} enabled ` +
          "integration_settings rows — tenant resolution is ambiguous. Resolving to the " +
          "oldest connection; disable the stale one(s) in Settings > Integrations.",
      );
    }

    const setting = settings?.[0] ?? null;
    if (!setting) {
      return NextResponse.json({ received: true });
    }

    const tenantId = setting.tenant_id;
    const value = parsed.entry?.[0]?.changes?.[0]?.value;

    // ── Inbound messages ──────────────────────────────────────────────────────
    for (const msg of value?.messages ?? []) {
      if (!msg.id || !msg.from) continue;

      // Idempotency: Meta retries on non-200; skip if already in communications.
      const { count } = await admin
        .from("communications")
        .select("id", { count: "exact", head: true })
        .eq("provider_message_id", msg.id)
        .eq("tenant_id", tenantId);

      if ((count ?? 0) > 0) continue;

      const senderPhone = normalizePhone(msg.from);
      const body = msg.text?.body ?? msg.caption ?? "";

      if (isOptOutMessage(body)) {
        const { error: optOutErr } = await admin
          .from("whatsapp_optouts")
          .upsert({ tenant_id: tenantId, phone: senderPhone }, { onConflict: "tenant_id,phone" });
        if (optOutErr) {
          console.error("[WA Webhook] opt-out upsert failed:", optOutErr.message, { tenantId, senderPhone });
          // Non-fatal — the inbound message itself still gets recorded below.
        }
      }

      let relatedToType: string | null = null;
      let relatedToId: string | null = null;

      const { data: matchedLead } = await admin
        .from("leads")
        .select("id")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .or(`phone.eq.${senderPhone},phone.eq.+${senderPhone}`)
        .maybeSingle();

      if (matchedLead) {
        relatedToType = "lead";
        relatedToId = matchedLead.id;
      } else {
        const { data: matchedContact } = await admin
          .from("contacts")
          .select("id")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .or(`phone.eq.${senderPhone},phone.eq.+${senderPhone}`)
          .maybeSingle();
        if (matchedContact) {
          relatedToType = "contact";
          relatedToId = matchedContact.id;
        }
      }

      const { error: insertErr } = await admin.from("communications").insert({
        tenant_id: tenantId,
        channel: "whatsapp",
        provider: "whatsapp_cloud",
        direction: "inbound",
        status: "received",
        to_phone: senderPhone,
        body,
        provider_message_id: msg.id,
        related_to_type: relatedToType,
        related_to_id: relatedToId,
        is_read: false,
      });

      if (insertErr) {
        // Distinct, greppable line — an inbound message failed to persist. This exact
        // failure mode (insert silently swallowed, webhook still 200'd to Meta so it
        // never retried) is what caused messages to go missing before — never let that
        // happen silently again. Return 500 so Meta redelivers; the idempotency check
        // above makes a retry safe even if other messages in this same payload already
        // succeeded.
        console.error("[WA Webhook] ALERT: inbound message insert failed — message NOT saved", {
          tenantId,
          providerMessageId: msg.id,
          error: insertErr.message,
          code: insertErr.code,
        });
        return NextResponse.json({ error: "insert_failed" }, { status: 500 });
      }
    }

    // ── Delivery / read status receipts ───────────────────────────────────────
    for (const s of value?.statuses ?? []) {
      if (!s.id || !s.status) continue;
      const mapped = STATUS_MAP[s.status];
      if (!mapped) continue;

      const { error: statusErr } = await admin
        .from("communications")
        .update({
          status: mapped,
          ...(mapped === "opened" ? { opened_at: new Date().toISOString() } : {}),
        })
        .eq("provider_message_id", s.id)
        .eq("tenant_id", tenantId)
        .eq("provider", "whatsapp_cloud");

      if (statusErr) {
        console.error("[WA Webhook] delivery-status update failed:", statusErr.message, {
          tenantId,
          providerMessageId: s.id,
          mapped,
        });
        // Non-fatal — a missed status receipt (sent/delivered/read) doesn't lose the
        // message itself, unlike a failed inbound insert. Don't fail the whole webhook.
      }
    }
  } catch {
    // Always 200 — Meta retries on non-200 responses.
  }

  return NextResponse.json({ received: true });
}

// ── Template status / quality events ──────────────────────────────────────────

// Statuses where Meta's explanation belongs in rejection_reason — not just REJECTED.
// PAUSED/DISABLED/FLAGGED carry their explanation in `other_info`, not `reason`.
const NEGATIVE_TEMPLATE_EVENTS = new Set(["REJECTED", "PAUSED", "DISABLED", "FLAGGED"]);

/**
 * Updates the local whatsapp_templates row for a message_template_status_update or
 * message_template_quality_update webhook event, keyed on waba_id + name + language
 * (the row already carries its own waba_id, so no separate tenant lookup is needed).
 *
 * PAUSED and DISABLED arrive here too, long after APPROVED — a client's template dying
 * mid-campaign must be surfaced (status flips, visible in the template list), not
 * swallowed the way an unmatched row or transient error silently would be.
 */
async function handleTemplateEvent(
  admin: ReturnType<typeof createAdminClient>,
  wabaId: string | undefined,
  field: string,
  value: TemplateEventValue | undefined,
) {
  const name = value?.message_template_name;
  const language = value?.message_template_language;
  if (!wabaId || !name || !language) return;

  const updates: Record<string, unknown> = { reviewed_at: new Date().toISOString() };

  if (field === "message_template_status_update") {
    const event = value?.event;
    if (!event || !KNOWN_TEMPLATE_STATUSES.has(event)) {
      // Log rather than silently drop so a transition Meta adds later leaves a trace
      // instead of vanishing the way IN_APPEAL/PENDING_DELETION/FLAGGED/REINSTATED did
      // before they were added to KNOWN_TEMPLATE_STATUSES.
      console.warn(
        `[WA Webhook] Unhandled template status event "${event}" for waba ${wabaId} ${name}/${language}`,
      );
      return;
    }
    updates.status = event;
    // REJECTED carries its explanation in `reason`; PAUSED/DISABLED/FLAGGED carry theirs
    // in `other_info` instead — check both rather than discarding whichever Meta didn't use.
    updates.rejection_reason = NEGATIVE_TEMPLATE_EVENTS.has(event)
      ? (value?.reason ?? value?.other_info?.description ?? value?.other_info?.title ?? null)
      : null;
    if (value?.message_template_id != null) updates.meta_template_id = String(value.message_template_id);
  } else {
    if (!value?.new_quality_score) return;
    updates.quality_score = value.new_quality_score;
  }

  const { error } = await admin
    .from("whatsapp_templates")
    .update(updates)
    .eq("waba_id", wabaId)
    .eq("name", name)
    .eq("language", language);

  if (error) {
    console.error("[WA Webhook] template event update failed:", error.message, { wabaId, name, language, field });
  }
}

// ── Meta webhook payload types ────────────────────────────────────────────────

interface TemplateEventValue {
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string | null;
  other_info?: { title?: string; description?: string } | null;
  previous_quality_score?: string;
  new_quality_score?: string;
}

interface MetaWebhookValue {
  metadata?: {
    phone_number_id?: string;
    display_phone_number?: string;
  };
  messages?: {
    id?: string;
    from?: string;
    type?: string;
    text?: { body?: string };
    caption?: string;
  }[];
  statuses?: {
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
  }[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      value?: MetaWebhookValue;
      field?: string;
    }[];
  }[];
}
