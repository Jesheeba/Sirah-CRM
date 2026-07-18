import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/whatsapp";

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

    // phone_number_id is how we route to the correct tenant.
    const phoneNumberId =
      parsed.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    console.log("[wa-webhook] phone_number_id:", phoneNumberId, "object:", parsed.object);
    if (!phoneNumberId) {
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();

    // Resolve tenant by phone_id — app_secret verified globally above, not needed per-row.
    const { data: settings } = await admin
      .from("integration_settings")
      .select("tenant_id")
      .eq("phone_id", phoneNumberId)
      .eq("channel", "whatsapp")
      .eq("is_enabled", true)
      .limit(1);

    const setting = settings?.[0] ?? null;
    console.log("[wa-webhook] tenant lookup:", setting?.tenant_id ?? "NOT FOUND");
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

      // Meta sends `from` as digits-only E.164 without '+' (e.g. "919876543210").
      // normalizePhone strips any remaining non-digits for safety.
      const senderPhone = normalizePhone(msg.from);
      const body = msg.text?.body ?? msg.caption ?? "";

      // Link to an existing lead or contact by normalised phone.
      // Check both with and without '+' since the CRM may store either format.
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

      // channel='whatsapp' is the medium the user sees; provider='whatsapp_cloud' is the transport.
      // Do NOT change channel to 'whatsapp_cloud' — the inbox groups by channel.
      await admin.from("communications").insert({
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
      });
    }

    // ── Delivery / read status receipts ───────────────────────────────────────
    for (const s of value?.statuses ?? []) {
      if (!s.id || !s.status) continue;
      const mapped = STATUS_MAP[s.status];
      if (!mapped) continue;

      await admin
        .from("communications")
        .update({
          status: mapped,
          ...(mapped === "opened" ? { opened_at: new Date().toISOString() } : {}),
        })
        .eq("provider_message_id", s.id)
        .eq("tenant_id", tenantId)
        .eq("provider", "whatsapp_cloud");
    }
  } catch {
    // Always 200 — Meta retries on non-200 responses.
  }

  return NextResponse.json({ received: true });
}

// ── Meta webhook payload types ────────────────────────────────────────────────

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
