import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { appBaseUrl } from "@/lib/meta";
import { verifySignedRequest } from "@/lib/meta-data-deletion";

export const runtime = "nodejs";

/**
 * Meta Data Deletion Callback.
 * Called when a Facebook user revokes the app's permissions. Verifies the signed_request,
 * enqueues the deletion (processed async by the workflow cron tick — see
 * src/lib/meta-data-deletion.ts), and responds with a confirmation URL + code within a
 * few seconds, per Meta's requirement.
 *
 * Docs: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export async function POST(req: NextRequest) {
  let signedRequest: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    signedRequest = new URLSearchParams(text).get("signed_request");
  } else {
    // Fallback: some integrations wrap it as JSON.
    try {
      const json = (await req.json()) as { signed_request?: string };
      signedRequest = json.signed_request ?? null;
    } catch {
      signedRequest = null;
    }
  }

  if (!signedRequest) {
    return NextResponse.json({ error: "missing_signed_request" }, { status: 400 });
  }

  if (!process.env.META_APP_SECRET && !process.env.FB_APP_SECRET) {
    console.error("[Meta Data Deletion] neither META_APP_SECRET nor FB_APP_SECRET is set.");
  }

  const verified = verifySignedRequest(signedRequest);
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const { payload, matchedSecret } = verified;
  const facebookUid = payload.user_id as string; // verifySignedRequest already rejects a missing user_id
  const issuedAt = payload.issued_at ? new Date(payload.issued_at * 1000).toISOString() : null;

  console.log(`[Meta Data Deletion] verified via ${matchedSecret} for user_id=${facebookUid}`);

  const admin = createAdminClient();

  // Replay detection: Meta retries the identical signed_request (same facebook_uid +
  // issued_at) if it doesn't get a fast 200. Return the existing confirmation instead of
  // creating a duplicate pending request / reprocessing the deletion.
  if (issuedAt) {
    const { data: existing } = await admin
      .from("meta_deletion_requests")
      .select("code")
      .eq("facebook_uid", facebookUid)
      .eq("issued_at", issuedAt)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        url: `${appBaseUrl()}/data-deletion-status?code=${existing.code}`,
        confirmation_code: existing.code,
      });
    }
  }

  const code = randomBytes(16).toString("hex");

  const { error: insErr } = await admin.from("meta_deletion_requests").insert({
    facebook_uid: facebookUid,
    code,
    status: "pending",
    issued_at: issuedAt,
    requested_at: new Date().toISOString(),
  });

  if (insErr) {
    console.error("[Meta Data Deletion] failed to record request:", insErr.message);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Deletion itself is NOT done here — the workflow cron tick picks up 'pending' rows
  // (processMetaDeletionRequests in lib/meta-data-deletion.ts) so this responds fast.
  return NextResponse.json({
    url: `${appBaseUrl()}/data-deletion-status?code=${code}`,
    confirmation_code: code,
  });
}
