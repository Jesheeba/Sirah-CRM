import { NextRequest, NextResponse } from "next/server";
import { metaVerifyToken, verifyMetaSignature } from "@/lib/meta";
import { processInstagramWebhookBody } from "@/lib/instagram-webhook-handler";

/** Webhook verification handshake (Meta calls GET once on subscribe). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token");
  const challenge = p.get("hub.challenge");
  if (mode === "subscribe" && token && token === metaVerifyToken()) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Receives Instagram `messages`/`feed` events. Verifies the signature, then delegates
 * to the shared handler (also called from /api/meta/leadgen, since Meta only allows one
 * callback URL per webhook object and the Page object's was already claimed by leadgen).
 * Always returns 200 so Meta doesn't retry indefinitely on our own logic errors.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ received: true });
  }
  await processInstagramWebhookBody(raw);
  return NextResponse.json({ received: true });
}
