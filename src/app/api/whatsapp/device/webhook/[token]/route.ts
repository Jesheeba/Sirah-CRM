import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/whatsapp";

// UltraMsg does NOT perform a hub.challenge verification handshake (unlike Meta).
// A simple 200 is sufficient for GET.
export async function GET() {
  return NextResponse.json({ ok: true });
}

/**
 * Inbound message webhook for UltraMsg-compatible device WhatsApp providers.
 * UltraMsg POSTs here for every inbound message received by the connected device.
 *
 * Auth: the [token] path segment is the `webhook_token` UUID from integration_settings
 * (a random secret generated at row creation, service-role-only). It is NOT the UltraMsg
 * instance_id — using a guessable public identifier would allow message spoofing.
 *
 * Always returns 200 so UltraMsg doesn't retry indefinitely.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      type?: string;
      data?: {
        id?: string;
        from?: string;
        body?: string;
        timestamp?: number;
      };
    };

    // Ignore non-message events (ack, status updates, etc.)
    if (body.type !== "message") {
      return NextResponse.json({ received: true });
    }

    const data = body.data ?? {};
    if (!data.id || !data.from || !data.body) {
      return NextResponse.json({ received: true });
    }

    const admin = createAdminClient();

    // Resolve tenant from webhook_token (secret column — service role required)
    const { data: setting } = await admin
      .from("integration_settings")
      .select("tenant_id, phone_id")
      .eq("webhook_token", token)
      .eq("channel", "whatsapp_device")
      .eq("is_enabled", true)
      .maybeSingle();

    // Return 200 silently — don't reveal whether the token exists
    if (!setting) {
      return NextResponse.json({ received: true });
    }

    // Idempotency: UltraMsg retries on non-200; skip if already processed
    const { count } = await admin
      .from("communications")
      .select("id", { count: "exact", head: true })
      .eq("provider_message_id", data.id)
      .eq("provider", "whatsapp_device");

    if ((count ?? 0) > 0) {
      return NextResponse.json({ received: true });
    }

    // Normalize sender phone.
    // UltraMsg sends "919876543210@c.us" — strip the @c.us suffix, then strip all
    // non-digits (same as normalizePhone) to get the digits-only format we store.
    const senderPhone = normalizePhone(data.from.replace(/@c\.us$/i, ""));

    // Link to an existing lead or contact by matching normalized phone on both sides.
    // We check both the raw stored value and the "+"-prefixed version since the CRM
    // may store phones in either format.
    let relatedToType: string | null = null;
    let relatedToId: string | null = null;

    const { data: matchedLead } = await admin
      .from("leads")
      .select("id")
      .eq("tenant_id", setting.tenant_id)
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
        .eq("tenant_id", setting.tenant_id)
        .is("deleted_at", null)
        .or(`phone.eq.${senderPhone},phone.eq.+${senderPhone}`)
        .maybeSingle();

      if (matchedContact) {
        relatedToType = "contact";
        relatedToId = matchedContact.id;
      }
    }

    // Insert inbound message.
    // channel='whatsapp' is the medium the user sees; provider='whatsapp_device' is the
    // transport layer. Do NOT change channel to 'whatsapp_device' — the inbox groups by channel.
    await admin.from("communications").insert({
      tenant_id: setting.tenant_id,
      channel: "whatsapp",
      provider: "whatsapp_device",
      direction: "inbound",
      status: "received",
      to_phone: senderPhone,
      body: data.body,
      provider_message_id: data.id,
      related_to_type: relatedToType,
      related_to_id: relatedToId,
    });
  } catch {
    // Always 200 so UltraMsg doesn't retry on a bad payload.
  }

  return NextResponse.json({ received: true });
}
