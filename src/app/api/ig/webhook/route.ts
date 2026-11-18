import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaVerifyToken } from "@/lib/meta";
import { parseIgWebhook, verifyIgSignature } from "@/lib/ig-webhook";
import { ingestIgEvents } from "@/lib/ig-ingest";

/** Webhook verification handshake (Meta calls GET once when the callback URL is saved). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const expected = process.env.IG_VERIFY_TOKEN || metaVerifyToken();
  if (p.get("hub.mode") === "subscribe" && expected && p.get("hub.verify_token") === expected) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Receives Instagram Login webhooks (comments, mentions, messages). The signature is checked
 * on the raw body FIRST; an unsigned or tampered request is ignored with a 200 so Meta never
 * retries it and a probe learns nothing. Failures after that are swallowed too — Meta would
 * otherwise retry the same payload for hours — and the ingest is idempotent on provider id.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyIgSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ received: true });
  }
  try {
    const events = parseIgWebhook(JSON.parse(raw));
    if (events.length) await ingestIgEvents(createAdminClient(), events);
  } catch {
    // swallow — always 200
  }
  return NextResponse.json({ received: true });
}
