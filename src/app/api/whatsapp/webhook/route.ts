import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Meta WhatsApp Cloud API status → our communications.status
const STATUS_MAP: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "opened",
  failed: "failed",
};

/** Webhook verification handshake (Meta calls GET once on subscribe). */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Delivery/read receipts (and could ingest inbound messages later). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      entry?: { changes?: { value?: { statuses?: { id?: string; status?: string }[] } }[] }[];
    };
    const statuses =
      body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];

    if (statuses.length) {
      const supabase = await createClient();
      for (const s of statuses) {
        if (!s.id || !s.status) continue;
        const mapped = STATUS_MAP[s.status];
        if (mapped) await supabase.rpc("fn_comm_update_status", { p_msg_id: s.id, p_status: mapped });
      }
    }
  } catch {
    // Always 200 so Meta doesn't retry indefinitely on a bad payload.
  }
  return NextResponse.json({ received: true });
}
