import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Node.js runtime required for the `crypto` module (HMAC verification).
export const runtime = "nodejs";

// Sentinel path segment for the single-shared-account fallback (RAZORPAY_WEBHOOK_SECRET
// env var) — mirrors the "env" mode in lib/payments.ts. Tenant-specific installs instead
// use their own random `webhook_token` (routed to below), same pattern as the
// whatsapp_device webhook (0030).
const ENV_TOKEN = "env";

export async function GET() {
  return NextResponse.json({ ok: true });
}

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment_link?: { entity?: { id?: string; amount_paid?: number } };
    payment?: { entity?: { id?: string; amount?: number; method?: string; status?: string } };
  };
}

/**
 * Inbound Razorpay webhook — the ONLY path that can mark a payment (and its invoice)
 * as paid. Verifies the HMAC-SHA256 signature (raw hex, no prefix — unlike Meta's
 * "sha256=" convention) BEFORE parsing or trusting anything in the body.
 *
 * Auth model: the [token] path segment routes to which webhook secret to verify
 * against (a tenant's own Razorpay account, or the shared env-level account) — it is
 * NOT itself the security boundary. The signature is. This differs from the
 * whatsapp_device webhook, where the URL token IS the sole auth (UltraMsg has no
 * signature scheme); Razorpay's cryptographic signature is strictly stronger.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const admin = createAdminClient();

  let webhookSecret: string | null = null;
  if (token === ENV_TOKEN) {
    webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? null;
  } else {
    const { data } = await admin
      .from("integration_settings")
      .select("webhook_secret")
      .eq("webhook_token", token)
      .eq("channel", "razorpay")
      .eq("is_enabled", true)
      .maybeSingle();
    webhookSecret = (data as { webhook_secret?: string } | null)?.webhook_secret ?? null;
  }

  if (!webhookSecret) {
    return new NextResponse("Unauthorized", { status: 400 });
  }

  // Buffer raw body FIRST — required for HMAC before JSON.parse consumes it.
  const rawBody = await req.text();

  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return new NextResponse("Unauthorized", { status: 400 });
  }

  try {
    const body = JSON.parse(rawBody) as RazorpayWebhookPayload;

    if (body.event !== "payment_link.paid") {
      return NextResponse.json({ received: true }); // ack, nothing to do yet
    }

    const linkId = body.payload?.payment_link?.entity?.id;
    const paymentId = body.payload?.payment?.entity?.id;
    const amountPaise = body.payload?.payment?.entity?.amount
      ?? body.payload?.payment_link?.entity?.amount_paid;
    const method = body.payload?.payment?.entity?.method ?? null;

    if (!linkId || !amountPaise) {
      return NextResponse.json({ received: true });
    }

    // Idempotency: Razorpay retries non-2xx responses; skip if this event was already recorded.
    const eventId = req.headers.get("x-razorpay-event-id") ?? `${body.event}:${linkId}:${paymentId ?? ""}`;
    const { error: dupeError } = await admin
      .from("payment_webhook_events")
      .insert({ event_id: eventId, event_type: body.event });

    if (dupeError) {
      // Unique violation ⇒ already processed. Any other error: fail closed (no double-credit risk either way).
      return NextResponse.json({ received: true });
    }

    await admin.rpc("fn_record_payment_captured", {
      p_razorpay_payment_link_id: linkId,
      p_razorpay_payment_id: paymentId ?? null,
      p_amount: amountPaise / 100,
      p_method: method,
      p_paid_at: new Date().toISOString(),
    });
  } catch {
    // Malformed payload after a valid signature shouldn't happen — ack anyway so
    // Razorpay doesn't retry indefinitely on something we can never parse.
  }

  return NextResponse.json({ received: true });
}
