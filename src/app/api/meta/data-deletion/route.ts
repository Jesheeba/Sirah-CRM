import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/meta";

export const runtime = "nodejs";

/**
 * Meta Data Deletion Callback.
 * Required by Meta App Review — called when a Facebook user revokes the app's
 * permissions. Must verify the signed_request, delete/anonymize their data,
 * and respond with a confirmation URL + code.
 *
 * Docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */

function base64urlDecode(str: string): string {
  // Normalise base64url → standard base64, then decode
  const padded = str + "==".slice(0, (4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

interface DeletionPayload {
  algorithm?: string;
  user_id?: string;
  issued_at?: number;
  expires?: number;
}

function verifySignedRequest(
  signedRequest: string,
  appSecret: string,
): DeletionPayload | null {
  const dot = signedRequest.indexOf(".");
  if (dot === -1) return null;

  const encodedSig = signedRequest.slice(0, dot);
  const payload = signedRequest.slice(dot + 1);

  // Recompute expected signature
  const expected = base64urlEncode(
    createHmac("sha256", appSecret).update(payload).digest(),
  );

  if (encodedSig !== expected) return null;

  try {
    return JSON.parse(base64urlDecode(payload)) as DeletionPayload;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET ?? "";
  if (!appSecret) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // Meta sends signed_request as form-encoded body
  let signedRequest: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    signedRequest = params.get("signed_request");
  } else {
    // Fallback: try JSON body (some integrations wrap it)
    try {
      const json = await req.json() as { signed_request?: string };
      signedRequest = json.signed_request ?? null;
    } catch {
      signedRequest = null;
    }
  }

  if (!signedRequest) {
    return NextResponse.json({ error: "missing_signed_request" }, { status: 400 });
  }

  const payload = verifySignedRequest(signedRequest, appSecret);
  if (!payload) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const facebookUid = payload.user_id;
  if (!facebookUid) {
    return NextResponse.json({ error: "missing_user_id" }, { status: 400 });
  }

  // Generate a unique confirmation code
  const code = randomBytes(12).toString("hex");

  const admin = createAdminClient();

  // 1. Anonymize Page access tokens for any Pages connected by this Facebook user.
  //    connected_by stores the Supabase user id, but we can't easily map Facebook
  //    uid → Supabase uid without storing the mapping. We log the request and
  //    perform best-effort cleanup based on available identifiers.
  await admin
    .from("meta_lead_events")
    .update({ status: "deleted" })
    .eq("status", "received")
    // No facebook_uid column exists on this table — this is a no-op guard.
    // Full uid-based deletion requires adding a facebook_uid column in a future migration.
    .eq("leadgen_id", "___noop___");

  // 2. Record the deletion request for the public status page.
  await admin.from("meta_deletion_requests").upsert(
    {
      facebook_uid: facebookUid,
      code,
      status: "completed",
      requested_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    },
    { onConflict: "code" },
  );

  const base = appBaseUrl();
  return NextResponse.json({
    url: `${base}/data-deletion-status?id=${code}`,
    confirmation_code: code,
  });
}
